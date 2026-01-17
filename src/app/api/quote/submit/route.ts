import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import OpenAI from "openai";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants, quoteLogs } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * IMPORTANT DESIGN NOTE
 * - We accept render_opt_in at TOP LEVEL (so it can be saved into quote_logs.input.render_opt_in).
 * - This matches what /api/quote/render checks later.
 * - We do NOT force render_opt_in into customer_context anymore.
 */

const Req = z.object({
  tenantSlug: z.string().min(3),
  images: z.array(z.object({ url: z.string().url() })).min(1).max(12),

  // NEW: customer opt-in stored at the top-level of quote_logs.input
  render_opt_in: z.boolean().optional().default(false),

  // keep flexible (your earlier versions used this)
  customer_context: z
    .object({
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      notes: z.string().optional(),
      service_type: z.string().optional(),
      category: z.string().optional(),
    })
    .optional(),
});

function json(data: any, status = 200, debugId?: string) {
  const res = NextResponse.json(debugId ? { debugId, ...data } : data, { status });
  if (debugId) res.headers.set("x-debug-id", debugId);
  return res;
}

async function getTenantBySlug(tenantSlug: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug)).limit(1);
  return rows[0] ?? null;
}

// tenant_secrets: tenant_id, openai_key_enc
async function getTenantOpenAiKey(tenantId: string): Promise<string | null> {
  // use raw SQL so we don't require schema typing for tenant_secrets table
  const r: any = await db.execute(
    // eslint-disable-next-line drizzle/enforce-delete-with-where
    // @ts-ignore
    db.sql`select openai_key_enc from tenant_secrets where tenant_id = ${tenantId} limit 1`
  );

  const row = r?.rows?.[0] ?? (Array.isArray(r) ? r[0] : null);
  const enc = row?.openai_key_enc ?? null;
  if (!enc) return null;
  return decryptSecret(enc);
}

export async function POST(req: Request) {
  const debugId = crypto.randomBytes(6).toString("hex");

  try {
    const raw = await req.json().catch(() => null);
    const parsed = Req.safeParse(raw);
    if (!parsed.success) {
      return json(
        { ok: false, error: "BAD_REQUEST_VALIDATION", issues: parsed.error.issues, received: raw },
        400,
        debugId
      );
    }

    const { tenantSlug, images, customer_context, render_opt_in } = parsed.data;

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return json({ ok: false, error: "TENANT_NOT_FOUND" }, 404, debugId);

    const tenantId = (tenant as any).id as string;

    // Store the inbound request (normalized) as quote_logs.input
    // Key point: include render_opt_in at top-level for /api/quote/render to read later.
    const input = {
      tenantSlug,
      images,
      render_opt_in: Boolean(render_opt_in),
      customer_context: customer_context ?? {},
    };

    // Create quote log row
    // quoteLogs is in your schema; it should have id, tenantId, input, output, createdAt, etc.
    const inserted: any = await db
      .insert(quoteLogs)
      // @ts-ignore
      .values({
        tenantId,
        input,
        output: null,
      })
      // @ts-ignore
      .returning({ id: quoteLogs.id });

    const quoteLogId = inserted?.[0]?.id ?? null;
    if (!quoteLogId) {
      return json({ ok: false, error: "QUOTE_CREATE_FAILED" }, 500, debugId);
    }

    // Generate assessment/estimate using tenant OpenAI key
    const openAiKey = await getTenantOpenAiKey(tenantId);
    if (!openAiKey) {
      return json(
        { ok: false, error: "OPENAI_KEY_MISSING", message: "Tenant OpenAI key is not configured." },
        500,
        debugId
      );
    }

    const openai = new OpenAI({ apiKey: openAiKey });

    const notes = (customer_context?.notes ?? "").toString();
    const category = (customer_context?.category ?? "service").toString();
    const serviceType = (customer_context?.service_type ?? "upholstery").toString();

    // Keep prompt simple/robust — you already have pricing logic elsewhere.
    const prompt = [
      "You are helping an upholstery (or service) shop produce an initial estimate range and questions from customer photos.",
      "Return JSON only with keys: confidence, inspection_required, summary, questions, estimate.",
      `Category: ${category}`,
      `Service type: ${serviceType}`,
      notes ? `Customer notes: ${notes}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // Build a multi-image message (OpenAI Vision)
    const visionInput = images.map((img) => ({
      type: "image_url",
      image_url: { url: img.url },
    }));

    const resp: any = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...visionInput,
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    let output: any = null;
    try {
      const text = resp?.choices?.[0]?.message?.content ?? "";
      output = text ? JSON.parse(text) : null;
    } catch {
      output = null;
    }

    // Always include render_opt_in in output so UI/debug is truthful
    const finalOutput = {
      ...(output ?? {}),
      meta: {
        ...(output?.meta ?? {}),
        render_opt_in: Boolean(render_opt_in),
      },
      render_opt_in: Boolean(render_opt_in),
    };

    // Update quote log output
    await db
      .update(quoteLogs)
      // @ts-ignore
      .set({ output: finalOutput })
      // @ts-ignore
      .where(eq(quoteLogs.id, quoteLogId));

    // IMPORTANT: You said the long-term goal:
    // - After submit: send lead email + persist
    // - After render: send render email + persist
    // We'll add the email sending in the next step once this flow is stable end-to-end.

    return json(
      {
        ok: true,
        quoteLogId,
        tenantId,
        output: finalOutput,
        render_opt_in: Boolean(render_opt_in),
      },
      200,
      debugId
    );
  } catch (err: any) {
    return json(
      { ok: false, error: "REQUEST_FAILED", message: err?.message ?? String(err) },
      500,
      debugId
    );
  }
}
