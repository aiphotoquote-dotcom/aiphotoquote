import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import OpenAI from "openai";
import crypto from "crypto";

import { db } from "@/lib/db/client";
import { tenants, tenantSettings } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";

const Req = z.object({
  tenantSlug: z.string().min(3),
  images: z.array(z.object({ url: z.string().url() })).min(1).max(12),
  customer_context: z
    .object({
      notes: z.string().optional(),
      service_type: z.string().optional(),
      category: z.string().optional(),
    })
    .optional(),
});

const QuoteOutputSchema = z.object({
  confidence: z.enum(["high", "medium", "low"]),
  inspection_required: z.boolean(),
  summary: z.string(),
  visible_scope: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  questions: z.array(z.string()).default([]),
});

function json(data: any, status = 200, debugId?: string) {
  const res = NextResponse.json(debugId ? { debugId, ...data } : data, { status });
  if (debugId) res.headers.set("x-debug-id", debugId);
  return res;
}

function normalizeDbErr(err: any) {
  return {
    name: err?.name,
    message: err?.message ?? String(err),
    code: err?.code, // SQLSTATE
    detail: err?.detail,
    hint: err?.hint,
    constraint: err?.constraint,
    table: err?.table,
    column: err?.column,
    schema: err?.schema,
    where: err?.where,
  };
}

function normalizeErr(err: any) {
  const status = typeof err?.status === "number" ? err.status : undefined;
  const message =
    err?.error?.message ??
    err?.response?.data?.error?.message ??
    err?.message ??
    String(err);
  const type = err?.error?.type ?? err?.response?.data?.error?.type ?? err?.type;
  const code = err?.error?.code ?? err?.response?.data?.error?.code ?? err?.code;
  return {
    name: err?.name,
    status,
    message,
    type,
    code,
    request_id: err?.request_id ?? err?.headers?.["x-request-id"],
  };
}

async function getTenantBySlug(tenantSlug: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug)).limit(1);
  return rows[0] ?? null;
}

// tenant_secrets schema you confirmed:
// tenant_id (pk), openai_key_enc text, openai_key_last4 text, updated_at timestamptz
async function getTenantOpenAiKey(tenantId: string): Promise<string | null> {
  const r = await db.execute(
    sql`select openai_key_enc from tenant_secrets where tenant_id = ${tenantId} limit 1`
  );
  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  const enc = row?.openai_key_enc ?? null;
  if (!enc) return null;
  return decryptSecret(enc);
}

async function preflightImageUrl(url: string) {
  const out: { ok: boolean; url: string; status?: number; hint?: string } = { ok: false, url };

  try {
    const headRes = await fetch(url, { method: "HEAD", redirect: "follow" });
    out.status = headRes.status;
    if (headRes.ok) {
      out.ok = true;
      return out;
    }
    out.hint = `HEAD returned ${headRes.status}`;
  } catch (e: any) {
    out.hint = `HEAD failed: ${e?.message ?? "unknown"}`;
  }

  try {
    const getRes = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { Range: "bytes=0-1023" },
    });
    out.status = getRes.status;
    if (getRes.ok || getRes.status === 206) {
      out.ok = true;
      return out;
    }
    out.hint = `GET returned ${getRes.status}`;
    return out;
  } catch (e: any) {
    out.hint = `GET failed: ${e?.message ?? "unknown"}`;
    return out;
  }
}

/**
 * Raw SQL insert into quote_logs with explicit values.
 * IMPORTANT: include created_at to satisfy NOT NULL (common cause of your failure).
 */
async function insertQuoteLog(tenantId: string, inputJson: any) {
  // Safe initial values; adjust later when pricing is implemented
  const confidence = "low";
  const inspectionRequired = true;
  const estimateLow = 0;
  const estimateHigh = 0;

  const inputStr = JSON.stringify(inputJson ?? {});
  const outputStr = JSON.stringify({ status: "started" });

  const r = await db.execute(sql`
    insert into quote_logs
      (tenant_id, input, output, confidence, estimate_low, estimate_high, inspection_required, created_at)
    values
      (
        ${tenantId},
        ${inputStr}::jsonb,
        ${outputStr}::jsonb,
        ${confidence},
        ${estimateLow}::numeric,
        ${estimateHigh}::numeric,
        ${inspectionRequired},
        now()
      )
    returning id
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  const id = row?.id ?? null;
  if (!id) throw new Error("quote_logs insert returned no id");
  return id as string;
}

async function updateQuoteLogCompleted(
  quoteLogId: string,
  assessment: any,
  confidence: string,
  inspectionRequired: boolean
) {
  const outputStr = JSON.stringify(assessment ?? {});
  await db.execute(sql`
    update quote_logs
    set
      output = ${outputStr}::jsonb,
      confidence = ${confidence},
      inspection_required = ${inspectionRequired}
    where id = ${quoteLogId}
  `);
}

export async function POST(req: Request) {
  const debugId = crypto.randomBytes(6).toString("hex");
  const startedAt = Date.now();
  let quoteLogId: string | null = null;

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

    const { tenantSlug, images, customer_context } = parsed.data;

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return json(
        { ok: false, error: "TENANT_NOT_FOUND", message: `No tenant found: ${tenantSlug}` },
        404,
        debugId
      );
    }

    // optional, best-effort
    try {
      await db
        .select()
        .from(tenantSettings)
        .where(eq(tenantSettings.tenantId, (tenant as any).id))
        .limit(1);
    } catch {}

    const openAiKey = await getTenantOpenAiKey((tenant as any).id);
    if (!openAiKey) {
      return json(
        {
          ok: false,
          error: "OPENAI_KEY_MISSING",
          message: "Tenant OpenAI key not configured in tenant_secrets.openai_key_enc.",
        },
        500,
        debugId
      );
    }

    // Preflight images
    const checks = await Promise.all(images.map((i) => preflightImageUrl(i.url)));
    const bad = checks.filter((c) => !c.ok);
    if (bad.length) {
      return json(
        {
          ok: false,
          error: "IMAGE_URL_NOT_FETCHABLE",
          message: "One or more image URLs cannot be fetched publicly from the server.",
          bad,
        },
        400,
        debugId
      );
    }

    // Insert quote log (fail loudly with real DB detail)
    try {
      quoteLogId = await insertQuoteLog((tenant as any).id, raw);
    } catch (e: any) {
      const dbErr = normalizeDbErr(e);
      return json(
        { ok: false, error: "QUOTE_LOG_INSERT_FAILED", message: dbErr.message, dbErr },
        500,
        debugId
      );
    }

    const notes = customer_context?.notes?.trim();
    const serviceType = customer_context?.service_type?.trim();
    const category = customer_context?.category?.trim();

    const promptLines = [
      "You are an expert marine + auto upholstery estimator.",
      "Return ONLY valid JSON with:",
      `confidence: "high"|"medium"|"low"`,
      "inspection_required: boolean",
      "summary: string",
      "visible_scope: string[]",
      "assumptions: string[]",
      "questions: string[]",
      "",
      "Rules:",
      "- If anything is unclear from photos, set inspection_required=true and add questions.",
      "- Be practical and shop-accurate; avoid wild guesses.",
    ];
    if (category) promptLines.push(`Category: ${category}`);
    if (serviceType) promptLines.push(`Service type: ${serviceType}`);
    if (notes) promptLines.push(`Customer notes: ${notes}`);

    const openai = new OpenAI({ apiKey: openAiKey });

    const content = [
      { type: "input_text" as const, text: promptLines.join("\n") },
      ...images.map((img) => ({
        type: "input_image" as const,
        image_url: img.url,
        detail: "auto" as const,
      })),
    ];

    const r = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [{ role: "user", content }],
      text: { format: { type: "json_object" } },
    });

    const rawText = r.output_text?.trim() || "";

    let structured: z.infer<typeof QuoteOutputSchema> | null = null;
    try {
      const obj = JSON.parse(rawText);
      const validated = QuoteOutputSchema.safeParse(obj);
      structured = validated.success ? validated.data : null;
    } catch {}

    const finalAssessment =
      structured ?? { rawText, parse_warning: "Model did not return valid JSON per schema." };

    // Update quote log with completed output (best effort)
    try {
      const conf = structured?.confidence ?? "low";
      const insp = structured?.inspection_required ?? true;
      await updateQuoteLogCompleted(quoteLogId, finalAssessment, conf, insp);
    } catch (e: any) {
      return json(
        {
          ok: true,
          quoteLogId,
          tenantId: (tenant as any).id,
          imagePreflight: checks,
          assessment: finalAssessment,
          warning: `quote_logs update failed: ${normalizeDbErr(e).message}`,
          durationMs: Date.now() - startedAt,
        },
        200,
        debugId
      );
    }

    return json(
      {
        ok: true,
        quoteLogId,
        tenantId: (tenant as any).id,
        imagePreflight: checks,
        assessment: finalAssessment,
        durationMs: Date.now() - startedAt,
      },
      200,
      debugId
    );
  } catch (err: any) {
    const e = normalizeErr(err);

    // If we already have a quoteLogId, try to store the error (best effort)
    try {
      if (quoteLogId) {
        const out = JSON.stringify({ error: e });
        await db.execute(sql`
          update quote_logs
          set output = ${out}::jsonb
          where id = ${quoteLogId}
        `);
      }
    } catch {}

    return json({ ok: false, error: "REQUEST_FAILED", ...e }, e.status ?? 500, debugId);
  }
}
