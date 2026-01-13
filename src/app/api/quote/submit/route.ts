import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import OpenAI from "openai";

import { db } from "@/lib/db/client";
import { tenants, tenantSecrets, tenantSettings, quoteLogs } from "@/lib/db/schema";
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

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
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

async function getOpenAiKeyForTenant(tenantId: string) {
  const rows = await db.select().from(tenantSecrets).where(eq(tenantSecrets.tenantId, tenantId)).limit(1);
  const secret = rows[0] ?? null;

  const enc = secret ? (secret as any).openaiKeyEnc : null;
  const dec = enc ? decryptSecret(enc) : null;

  return dec || process.env.OPENAI_API_KEY || null;
}

async function preflightImageUrl(url: string) {
  const out: {
    ok: boolean;
    url: string;
    status?: number;
    contentType?: string | null;
    finalUrl?: string;
    hint?: string;
  } = { ok: false, url };

  try {
    const headRes = await fetch(url, { method: "HEAD", redirect: "follow" });
    out.status = headRes.status;
    out.finalUrl = headRes.url;
    out.contentType = headRes.headers.get("content-type");
    if (headRes.ok) {
      out.ok = true;
      return out;
    }
    out.hint = `HEAD returned ${headRes.status}.`;
  } catch (e: any) {
    out.hint = `HEAD failed (${e?.message ?? "unknown"}).`;
  }

  try {
    const getRes = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { Range: "bytes=0-1023" },
    });
    out.status = getRes.status;
    out.finalUrl = getRes.url;
    out.contentType = getRes.headers.get("content-type");
    if (getRes.ok || getRes.status === 206) {
      out.ok = true;
      return out;
    }
    out.hint = `GET returned ${getRes.status}.`;
    return out;
  } catch (e: any) {
    out.hint = `GET failed (${e?.message ?? "unknown"}).`;
    return out;
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  let quoteLogId: string | null = null;

  try {
    const raw = await req.json().catch(() => null);

    const parsed = Req.safeParse(raw);
    if (!parsed.success) {
      return json(
        { ok: false, error: "BAD_REQUEST_VALIDATION", issues: parsed.error.issues, received: raw },
        400
      );
    }

    const { tenantSlug, images, customer_context } = parsed.data;

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return json({ ok: false, error: "TENANT_NOT_FOUND", message: `No tenant found: ${tenantSlug}` }, 404);
    }

    const settingsRows = await db
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, (tenant as any).id))
      .limit(1);
    const settings = settingsRows[0] ?? null;

    const openAiKey = await getOpenAiKeyForTenant((tenant as any).id);
    if (!openAiKey) {
      return json(
        { ok: false, error: "OPENAI_KEY_MISSING", message: "Tenant OpenAI key missing (and no env fallback)." },
        500
      );
    }

    // log (best effort)
    try {
      const inserted = await db
        .insert(quoteLogs)
        .values({ tenantId: (tenant as any).id, requestJson: raw, status: "started" } as any)
        .returning({ id: (quoteLogs as any).id });
      quoteLogId = inserted?.[0]?.id ?? null;
    } catch {}

    // image preflight
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
        400
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

    // --- Attempt #1: image_url as STRING (your current typings want this) ---
    const contentA = [
      { type: "input_text" as const, text: promptLines.join("\n") },
      ...images.map((img) => ({
        type: "input_image" as const,
        image_url: img.url,
        detail: "auto" as const,
      })),
    ];

    // --- Attempt #2 (auto fallback): image_url as OBJECT ---
    // Some environments/models/tooling expect { url }.
    const contentB = [
      { type: "input_text" as const, text: promptLines.join("\n") },
      ...images.map((img) => ({
        type: "input_image" as const,
        image_url: { url: img.url } as any,
        detail: "auto" as const,
      })),
    ];

    let responseText = "";
    let usedFormat: "A_string" | "B_object" = "A_string";

    try {
      const r1 = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: [{ role: "user", content: contentA }],
        text: { format: { type: "json_object" } },
      });
      responseText = r1.output_text?.trim() || "";
    } catch (e1: any) {
      const n1 = normalizeErr(e1);

      // Retry only for invalid request style failures
      if ((n1.status && n1.status >= 400 && n1.status < 500) || String(n1.type).includes("invalid")) {
        usedFormat = "B_object";
        const r2 = await openai.responses.create({
          model: "gpt-4.1-mini",
          input: [{ role: "user", content: contentB as any }],
          text: { format: { type: "json_object" } },
        });
        responseText = r2.output_text?.trim() || "";
      } else {
        throw e1;
      }
    }

    // Parse output
    let structured: z.infer<typeof QuoteOutputSchema> | null = null;
    try {
      const obj = JSON.parse(responseText);
      const validated = QuoteOutputSchema.safeParse(obj);
      structured = validated.success ? validated.data : null;
    } catch {}

    // log completion (best effort)
    try {
      if (quoteLogId) {
        await db
          .update(quoteLogs)
          .set({
            status: "completed",
            responseJson: structured ?? { rawText: responseText },
            durationMs: Date.now() - startedAt,
          } as any)
          .where(eq((quoteLogs as any).id, quoteLogId));
      }
    } catch {}

    return json({
      ok: true,
      quoteLogId,
      tenantId: (tenant as any).id,
      settingsFound: !!settings,
      imagePreflight: checks,
      openaiPayloadFormatUsed: usedFormat,
      assessment: structured ?? { rawText: responseText, parse_warning: "Model did not return valid JSON per schema." },
    });
  } catch (err: any) {
    const e = normalizeErr(err);

    try {
      if (quoteLogId) {
        await db
          .update(quoteLogs)
          .set({ status: "error", errorJson: e, durationMs: Date.now() - startedAt } as any)
          .where(eq((quoteLogs as any).id, quoteLogId));
      }
    } catch {}

    const status = e.status ?? 500;
    return json({ ok: false, error: "REQUEST_FAILED", ...e }, status);
  }
}
