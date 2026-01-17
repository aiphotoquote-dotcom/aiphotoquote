import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import OpenAI from "openai";

import { db } from "@/lib/db/client";
import { tenants, tenantSecrets, quoteLogs } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Contract:
 * - tenantSlug: string
 * - images: [{ url, shotType }]
 * - customer_context: optional (notes/category/service_type/etc)
 * - contact: optional (name/email/phone)
 * - render_opt_in: optional boolean (TOP LEVEL)
 *
 * IMPORTANT: Tenant-key-only mode
 * - We DO NOT use OPENAI_API_KEY fallback.
 * - If tenant key missing => 400 TENANT_OPENAI_KEY_MISSING
 */

const Req = z.object({
  tenantSlug: z.string().min(3),
  images: z
    .array(
      z.object({
        url: z.string().url(),
        shotType: z.enum(["wide", "closeup", "extra"]).optional(),
      })
    )
    .min(1)
    .max(12),

  customer_context: z
    .object({
      notes: z.string().optional(),
      category: z.string().optional(),
      service_type: z.string().optional(),
    })
    .optional(),

  contact: z
    .object({
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
    })
    .optional(),

  // ✅ TOP LEVEL (so it can be stored in quote_logs.render_opt_in)
  render_opt_in: z.boolean().optional().default(false),
});

function jsonOk(data: any, init?: ResponseInit) {
  return NextResponse.json({ ok: true, ...data }, init);
}

function jsonErr(
  error: string,
  message: string,
  init?: ResponseInit & { debugId?: string; issues?: any[] }
) {
  const payload: any = { ok: false, error, message };
  if (init?.debugId) payload.debugId = init.debugId;
  if (init?.issues) payload.issues = init.issues;
  return NextResponse.json(payload, init);
}

function safeDebugId() {
  return `dbg_${Math.random().toString(36).slice(2, 10)}`;
}

export async function POST(req: Request) {
  const debugId = safeDebugId();

  try {
    const body = await req.json().catch(() => null);
    const parsed = Req.safeParse(body);

    if (!parsed.success) {
      return jsonErr("BAD_REQUEST", "Invalid request", {
        status: 400,
        debugId,
        issues: parsed.error.issues,
      });
    }

    const { tenantSlug, images, customer_context, contact, render_opt_in } =
      parsed.data;

    // ---- tenant lookup (no db.query.* so we avoid schema-generic TS issues) ----
    const tenantRows = await db
      .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.slug, tenantSlug))
      .limit(1);

    const tenant = tenantRows[0] ?? null;

    if (!tenant) {
      return jsonErr(
        "TENANT_NOT_FOUND",
        `Unknown tenant: ${tenantSlug}`,
        { status: 404, debugId }
      );
    }

    // ---- tenant secret lookup (tenant-key-only mode) ----
    const secretRows = await db
      .select({ openaiKeyEnc: tenantSecrets.openaiKeyEnc })
      .from(tenantSecrets)
      .where(eq(tenantSecrets.tenantId, tenant.id))
      .limit(1);

    const secret = secretRows[0] ?? null;

    if (!secret?.openaiKeyEnc) {
      return jsonErr(
        "TENANT_OPENAI_KEY_MISSING",
        "This shop has not connected an OpenAI API key yet. Please contact the shop owner.",
        { status: 400, debugId }
      );
    }

    const tenantApiKey = decryptSecret(secret.openaiKeyEnc);
    if (!tenantApiKey || String(tenantApiKey).trim().length < 20) {
      return jsonErr(
        "TENANT_OPENAI_KEY_INVALID",
        "The shop’s OpenAI key could not be decrypted. Please reconnect the key in settings.",
        { status: 400, debugId }
      );
    }

    // ---- create quote log first (output is NOT NULL in DB) ----
    const input = {
      tenantSlug,
      images,
      customer_context: customer_context ?? null,
      contact: contact ?? null,
      render_opt_in: Boolean(render_opt_in),
      createdAt: new Date().toISOString(),
    };

    const insertRows = await db
      .insert(quoteLogs)
      .values({
        tenantId: tenant.id,
        input,
        output: {}, // ✅ satisfy NOT NULL immediately
        renderOptIn: Boolean(render_opt_in),
        renderStatus: Boolean(render_opt_in) ? "queued" : "not_requested",
      })
      .returning({ id: quoteLogs.id });

    const quoteLogId = insertRows[0]?.id ?? null;

    // ---- OpenAI call using TENANT KEY ONLY ----
    const openai = new OpenAI({ apiKey: tenantApiKey });

    const prompt = `
You are an expert estimator for service work (starting with upholstery).
Given the customer's photos and note, produce a concise JSON-only assessment:

Return JSON with:
- confidence: "high" | "medium" | "low"
- inspection_required: boolean
- summary: string (customer-friendly)
- visible_scope: string[] (what you can see in photos)
- assumptions: string[] (what you assumed)
- questions: string[] (what you need to confirm)
- estimate: { low: number, high: number }
- render_opt_in: boolean (echo back the input render opt-in)
`;

    // Use any[] to avoid OpenAI SDK content-part typing mismatches across versions.
    const visionInput: any[] = images.map((img) => ({
      type: "image_url",
      image_url: { url: img.url },
    }));

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" as any },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt } as any,
            ...visionInput,
            ...(customer_context?.notes
              ? ([{ type: "text", text: `Customer notes: ${customer_context.notes}` }] as any[])
              : []),
          ] as any,
        },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content ?? "{}";

    let output: any = {};
    try {
      output = raw ? JSON.parse(raw) : {};
    } catch {
      output = { raw };
    }

    // Ensure output includes the opt-in (truthful UI/debug)
    output.render_opt_in = Boolean(render_opt_in);

    // ---- update quote log with output ----
    if (quoteLogId) {
      await db
        .update(quoteLogs)
        .set({
          output,
          confidence: output?.confidence ?? null,
          inspectionRequired:
            typeof output?.inspection_required === "boolean"
              ? output.inspection_required
              : null,
          estimateLow:
            typeof output?.estimate?.low === "number" ? output.estimate.low : null,
          estimateHigh:
            typeof output?.estimate?.high === "number" ? output.estimate.high : null,
        })
        .where(eq(quoteLogs.id, quoteLogId));
    }

    return jsonOk(
      {
        quoteLogId,
        output,
        render_opt_in: Boolean(render_opt_in),
      },
      { status: 200 }
    );
  } catch (err: any) {
    const msg = err?.message ? String(err.message) : String(err);
    console.error("QUOTE_SUBMIT_ERROR", { debugId, msg, err });

    // If OpenAI complains about missing/invalid key, surface as tenant-key error (still 400)
    if (
      msg.toLowerCase().includes("missing credentials") ||
      msg.toLowerCase().includes("api key") ||
      msg.toLowerCase().includes("incorrect api key") ||
      msg.toLowerCase().includes("invalid api key")
    ) {
      return jsonErr(
        "TENANT_OPENAI_KEY_INVALID",
        "The shop’s OpenAI key is missing or invalid. Please reconnect the key in settings.",
        { status: 400, debugId }
      );
    }

    return jsonErr("REQUEST_FAILED", msg, { status: 500, debugId });
  }
}
