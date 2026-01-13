import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import OpenAI from "openai";
import crypto from "crypto";

import { db } from "@/lib/db/client";
import { tenants, tenantSettings, quoteLogs } from "@/lib/db/schema";
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

/**
 * IMPORTANT: Use raw SQL so we match your real DB schema:
 * tenant_secrets(tenant_id PK, openai_key_enc, openai_key_last4, updated_at)
 */
async function getTenantOpenAiKey(tenantId: string): Promise<string | null> {
  const r = await db.execute(
    sql`select openai_key_enc from tenant_secrets where tenant_id = ${tenantId} limit 1`
  );

  // Drizzle returns different shapes depending on driver; handle both.
  const row: any =
    (r as any)?.rows?.[0] ??
    (Array.isArray(r) ? (r as any)[0] : null);

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

    // Optional settings fetch (best effort)
    try {
      await db
        .select()
        .from(tenantSettings)
        .where(eq(tenantSettings.tenantId, (tenant as any).id))
        .limit(1);
    } catch {}

    // ✅ Tenant-based key (no global OPENAI_API_KEY)
    const openAiKey = await getTenantOpenAiKey((tenant as any).id);
    if (!openAiKey) {
      return json(
        {
          ok: false,
          error: "OPENAI_KEY_MISSING",
          message:
            "Tenant OpenAI key not configured. Set tenant_secrets.openai_key_enc for this tenant_id.",
        },
        500,
        debugId
      );
    }

    // Log (best effort)
    try {
      const inserted = await db
        .insert(quoteLogs)
        .values({ tenantId: (tenant as any).id, requestJson: raw, status: "started" } as any)
        .returning({ id: (quoteLogs as any).id });
      quoteLogId = inserted?.[0]?.id ?? null;
    } catch {}

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

    // Update log (best effort)
    try {
      if (quoteLogId) {
        await db
          .update(quoteLogs)
          .set({
            status: "completed",
            responseJson: structured ?? { rawText },
            durationMs: Date.now() - startedAt,
          } as any)
          .where(eq((quoteLogs as any).id, quoteLogId));
      }
    } catch {}

    return json(
      {
        ok: true,
        quoteLogId,
        tenantId: (tenant as any).id,
        imagePreflight: checks,
        assessment:
          structured ?? { rawText, parse_warning: "Model did not return valid JSON per schema." },
      },
      200,
      debugId
    );
  } catch (err: any) {
    const e = normalizeErr(err);

    // Update log (best effort)
    try {
      if (quoteLogId) {
        await db
          .update(quoteLogs)
          .set({ status: "error", errorJson: e, durationMs: Date.now() - startedAt } as any)
          .where(eq((quoteLogs as any).id, quoteLogId));
      }
    } catch {}

    return json({ ok: false, error: "REQUEST_FAILED", ...e }, e.status ?? 500, debugId);
  }
}
