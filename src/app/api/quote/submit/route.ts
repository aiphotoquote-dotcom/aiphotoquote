import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import OpenAI from "openai";
import crypto from "crypto";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * IMPORTANT DESIGN NOTES
 * - render_opt_in is accepted at TOP LEVEL and persisted into quote_logs.input.render_opt_in
 * - images[] are URLs already stored in Blob
 * - This endpoint is "Step 1": create quote + return estimate/assessment + send lead emails (if your code does that elsewhere)
 * - "Step 2" AI rendering is handled by /api/quote/render (separate route)
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

      // NOTE: do NOT rely on this for persistence; we persist the top-level render_opt_in.
      render_opt_in: z.boolean().optional(),
    })
    .optional(),

  // ✅ top-level opt-in (persisted)
  render_opt_in: z.boolean().optional().default(false),

  contact: z
    .object({
      name: z.string().min(1),
      email: z.string().email(),
      phone: z.string().min(7),
    })
    .optional(),
});

function json(data: any, status = 200, debugId?: string) {
  const res = NextResponse.json(debugId ? { debugId, ...data } : data, { status });
  if (debugId) res.headers.set("x-debug-id", debugId);
  return res;
}

function safeJsonParse(v: any) {
  try {
    if (v == null) return null;
    if (typeof v === "object") return v;
    if (typeof v === "string") return JSON.parse(v);
    return v;
  } catch {
    return null;
  }
}

function normalizeDbErr(err: any) {
  return {
    name: err?.name,
    message: err?.message ?? String(err),
    code: err?.code,
    detail: err?.detail,
    hint: err?.hint,
    constraint: err?.constraint,
    table: err?.table,
    column: err?.column,
    where: err?.where,
    causeMessage: err?.cause?.message,
    causeCode: err?.cause?.code,
    causeDetail: err?.cause?.detail,
  };
}

async function getTenantBySlug(tenantSlug: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug)).limit(1);
  return rows[0] ?? null;
}

async function getTenantOpenAiKey(tenantId: string): Promise<string | null> {
  const r = await db.execute(
    sql`select openai_key_enc from tenant_secrets where tenant_id = ${tenantId} limit 1`
  );
  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  const enc = row?.openai_key_enc ?? null;
  if (!enc) return null;
  return decryptSecret(enc);
}

async function getTenantPricingRulesBestEffort(tenantId: string) {
  // Your earlier failure was: created_at column missing. So we try created_at, then updated_at.
  try {
    const r = await db.execute(sql`
      select min_job, typical_low, typical_high, max_without_inspection
      from tenant_pricing_rules
      where tenant_id = ${tenantId}::uuid
      order by created_at desc nulls last
      limit 1
    `);
    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
    return row ?? null;
  } catch {
    try {
      const r = await db.execute(sql`
        select min_job, typical_low, typical_high, max_without_inspection
        from tenant_pricing_rules
        where tenant_id = ${tenantId}::uuid
        order by updated_at desc nulls last
        limit 1
      `);
      const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
      return row ?? null;
    } catch {
      return null;
    }
  }
}

async function insertQuoteLog(args: {
  tenantId: string;
  input: any;
}) {
  const { tenantId, input } = args;
  const inputStr = JSON.stringify(input ?? {});
  const r = await db.execute(sql`
    insert into quote_logs (tenant_id, input)
    values (${tenantId}::uuid, ${inputStr}::jsonb)
    returning id
  `);
  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  return row?.id ? String(row.id) : null;
}

async function updateQuoteLogOutput(args: { quoteLogId: string; output: any }) {
  const { quoteLogId, output } = args;
  const outStr = JSON.stringify(output ?? {});
  await db.execute(sql`
    update quote_logs
    set output = ${outStr}::jsonb
    where id = ${quoteLogId}::uuid
  `);
}

export async function POST(req: Request) {
  const debugId = crypto.randomBytes(6).toString("hex");
  const startedAt = Date.now();

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

    const { tenantSlug, images, customer_context, render_opt_in, contact } = parsed.data;

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return json({ ok: false, error: "TENANT_NOT_FOUND" }, 404, debugId);

    const tenantId = String((tenant as any).id);

    // Persist input ASAP (so leads exist even if OpenAI fails)
    const input = {
      tenantSlug,
      images,
      customer_context: customer_context ?? {},
      contact: contact ?? {},
      render_opt_in: Boolean(render_opt_in), // ✅ key point
      createdAt: new Date().toISOString(),
    };

    const quoteLogId = await insertQuoteLog({ tenantId, input });
    if (!quoteLogId) {
      return json({ ok: false, error: "QUOTE_LOG_INSERT_FAILED" }, 500, debugId);
    }

    // Pricing rules (best-effort)
    const pricing = await getTenantPricingRulesBestEffort(tenantId);

    // OpenAI assessment (best-effort but normally required)
    const openAiKey = await getTenantOpenAiKey(tenantId);
    if (!openAiKey) {
      // still return the quoteLogId so admin/lead exists
      const output = {
        confidence: "low",
        inspection_required: true,
        summary: "Missing tenant OpenAI key. Unable to generate estimate automatically.",
        visible_scope: [],
        assumptions: [],
        questions: [],
        pricing,
        meta: { render_opt_in: Boolean(render_opt_in) },
      };
      await updateQuoteLogOutput({ quoteLogId, output });

      return json(
        {
          ok: true,
          quoteLogId,
          output,
          render_opt_in: Boolean(render_opt_in),
          durationMs: Date.now() - startedAt,
        },
        200,
        debugId
      );
    }

    const openai = new OpenAI({ apiKey: openAiKey });

    const notes = (customer_context?.notes ?? "").toString().trim();
    const category = (customer_context?.category ?? "").toString().trim();
    const serviceType = (customer_context?.service_type ?? "").toString().trim();

    const prompt = [
      "You are an expert estimator for a service business (upholstery/marine/auto).",
      "Given the photos, return a JSON estimate response.",
      "Do not include markdown. Return ONLY valid JSON.",
      "",
      "Required JSON keys:",
      "- confidence: 'high' | 'medium' | 'low'",
      "- inspection_required: boolean",
      "- summary: string",
      "- visible_scope: string[]",
      "- assumptions: string[]",
      "- questions: string[]",
      "- estimate: { low: number, high: number, currency: 'USD' }",
      "",
      pricing
        ? `Pricing context (may be null): ${JSON.stringify(pricing)}`
        : "Pricing context: null",
      category ? `Category: ${category}` : "",
      serviceType ? `Service type: ${serviceType}` : "",
      notes ? `Customer notes: ${notes}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // ✅ FIX: make image content parts typed as literal "image_url"
    // so TS doesn’t widen `type` to `string`.
    const visionInput: Array<{ type: "image_url"; image_url: { url: string } }> = images.map((x) => ({
      type: "image_url",
      image_url: { url: x.url },
    }));

    let output: any = null;

    try {
      const resp = await openai.chat.completions.create({
        // Pick the model you’re already using in this repo; this is a safe default.
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              ...visionInput,
            ] as any, // SDK types vary; keep runtime correct and TS satisfied.
          },
        ],
      } as any);

      const text = resp?.choices?.[0]?.message?.content ?? "";
      output = safeJsonParse(text) ?? { raw: text };

      // Always include render_opt_in in the output so UI/debug is truthful
      output = {
        ...output,
        meta: { ...(output?.meta ?? {}), render_opt_in: Boolean(render_opt_in) },
        render_opt_in: Boolean(render_opt_in),
      };
    } catch (e: any) {
      output = {
        confidence: "low",
        inspection_required: true,
        summary: "AI estimate failed. A human inspection is required.",
        visible_scope: [],
        assumptions: [],
        questions: [],
        pricing,
        error: e?.message ?? "OpenAI error",
        meta: { render_opt_in: Boolean(render_opt_in) },
        render_opt_in: Boolean(render_opt_in),
      };
    }

    await updateQuoteLogOutput({ quoteLogId, output });

    return json(
      {
        ok: true,
        quoteLogId,
        output,
        render_opt_in: Boolean(render_opt_in),
        durationMs: Date.now() - startedAt,
      },
      200,
      debugId
    );
  } catch (err: any) {
    return json(
      {
        ok: false,
        error: "REQUEST_FAILED",
        message: err?.message ?? String(err),
        db: err?.code ? normalizeDbErr(err) : undefined,
      },
      500,
      crypto.randomBytes(6).toString("hex")
    );
  }
}
