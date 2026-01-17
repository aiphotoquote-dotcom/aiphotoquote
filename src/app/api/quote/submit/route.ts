import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import OpenAI from "openai";

import { db } from "@/lib/db/client";
import { tenants, tenantSecrets, quoteLogs } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * IMPORTANT CONTRACT:
 * - quote_logs.output is NOT NULL in DB
 * - Drizzle omits undefined fields from INSERT
 * - Therefore we MUST ALWAYS insert an `output` value.
 */

const Req = z.object({
  tenantSlug: z.string().min(3),
  images: z
    .array(
      z.object({
        url: z.string().url(),
        shotType: z.enum(["wide", "closeup", "extra"]).optional().default("extra"),
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
      name: z.string().min(1),
      email: z.string().min(3),
      phone: z.string().min(3),
    })
    .optional(),

  // Accept render opt-in at TOP LEVEL
  render_opt_in: z.boolean().optional().default(false),
});

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function safeStr(x: unknown) {
  return String(x ?? "");
}

export async function POST(req: Request) {
  const debugId = `dbg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const raw = await req.json().catch(() => null);
    const parsed = Req.safeParse(raw);

    if (!parsed.success) {
      return json(
        {
          ok: false,
          error: "BAD_REQUEST",
          message: "Invalid request body",
          issues: parsed.error.issues,
          debugId,
        },
        { status: 400 }
      );
    }

    const { tenantSlug, images, customer_context, contact, render_opt_in } = parsed.data;

    // ---- Tenant lookup (NO db.query.*; works without schema generic) ----
    const tenantRows = await db
      .select({ id: tenants.id, slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.slug, tenantSlug))
      .limit(1);

    const tenant = tenantRows[0] ?? null;

    if (!tenant) {
      return json(
        { ok: false, error: "TENANT_NOT_FOUND", message: "Invalid tenant link", debugId },
        { status: 404 }
      );
    }

    // ---- Tenant secret lookup ----
    const secretRows = await db
      .select({ openaiKeyEnc: tenantSecrets.openaiKeyEnc })
      .from(tenantSecrets)
      .where(eq(tenantSecrets.tenantId, tenant.id))
      .limit(1);

    const secret = secretRows[0] ?? null;

    if (!secret?.openaiKeyEnc) {
      return json(
        {
          ok: false,
          error: "TENANT_OPENAI_KEY_MISSING",
          message: "Tenant OpenAI key not configured",
          debugId,
        },
        { status: 400 }
      );
    }

    const openaiKey = decryptSecret(secret.openaiKeyEnc);
    const openai = new OpenAI({ apiKey: openaiKey });

    // ---- Prompt ----
    const prompt = [
      `You are an expert upholstery estimator.`,
      `Return JSON only.`,
      ``,
      `Need fields: confidence ("high"|"medium"|"low"), inspection_required (boolean), summary (string), questions (string[]), estimate {low:number, high:number}.`,
      `Echo render_opt_in boolean.`,
      ``,
      `Customer notes: ${safeStr(customer_context?.notes || "")}`,
      `Category: ${safeStr(customer_context?.category || "service")}`,
      `Service type: ${safeStr(customer_context?.service_type || "upholstery")}`,
      `Render opt-in: ${render_opt_in ? "true" : "false"}`,
    ].join("\n");

    // Vision parts (cast as any to avoid SDK typing mismatches)
    const visionInput: any[] = images.map((img) => ({
      type: "image_url",
      image_url: { url: img.url },
    }));

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }, ...visionInput] as any,
        },
      ],
    });

    const text = completion.choices?.[0]?.message?.content ?? "";
    let outputJson: any;

    try {
      outputJson = text ? JSON.parse(text) : null;
    } catch {
      // Never allow undefined output to reach DB
      outputJson = {
        confidence: "low",
        inspection_required: true,
        summary: "We could not parse the AI response. Please review manually.",
        questions: ["Can you provide clearer photos and confirm scope/material preference?"],
        estimate: { low: 0, high: 0 },
        render_opt_in: Boolean(render_opt_in),
        _raw: text?.slice(0, 2000),
      };
    }

    // Normalize key fields (defensive)
    const confidence = safeStr(outputJson?.confidence || "medium");
    const inspectionRequired = Boolean(outputJson?.inspection_required ?? true);
    const estLow = Number(outputJson?.estimate?.low ?? outputJson?.low ?? 0) || 0;
    const estHigh = Number(outputJson?.estimate?.high ?? outputJson?.high ?? 0) || 0;

    // Input payload for auditing
    const inputPayload = {
      tenantSlug,
      images,
      customer_context: customer_context ?? null,
      contact: contact ?? null,
      render_opt_in: Boolean(render_opt_in),
      createdAt: new Date().toISOString(),
    };

    // ✅ CRITICAL: ALWAYS insert output (never undefined)
    const inserted = await db
      .insert(quoteLogs)
      .values({
        tenantId: tenant.id,
        input: inputPayload as any,
        output: (outputJson ?? {}) as any,

        confidence,
        estimateLow: estLow || null,
        estimateHigh: estHigh || null,
        inspectionRequired,

        renderOptIn: Boolean(render_opt_in),
        renderStatus: Boolean(render_opt_in) ? "queued" : "not_requested",
      })
      .returning({ id: quoteLogs.id });

    const quoteLogId = inserted?.[0]?.id ?? null;

    return json(
      {
        ok: true,
        quoteLogId,
        tenantId: tenant.id,
        output: {
          ...outputJson,
          render_opt_in: Boolean(render_opt_in),
        },
        render_opt_in: Boolean(render_opt_in),
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("QUOTE_SUBMIT_ERROR", { debugId, err });

    return json(
      {
        ok: false,
        error: "REQUEST_FAILED",
        message: err?.message ?? String(err),
        debugId,
      },
      { status: 500 }
    );
  }
}
