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

/**
 * Your schema shows tenantSecrets has:
 * - tenantId
 * - openaiKeyEnc
 */
async function getOpenAiKeyForTenant(tenantId: string) {
  const rows = await db
    .select()
    .from(tenantSecrets)
    .where(eq(tenantSecrets.tenantId, tenantId))
    .limit(1);

  const secret = rows[0] ?? null;
  const enc = secret ? (secret as any).openaiKeyEnc : null;
  const dec = enc ? decryptSecret(enc) : null;

  return dec || process.env.OPENAI_API_KEY || null;
}

/**
 * Preflight each image URL from the server (catches the #1 cause of "Invalid request"):
 * - HEAD (fast)
 * - fallback tiny GET range
 */
async function preflightImageUrl(url: string) {
  const out: {
    ok: boolean;
    url: string;
    status?: number;
    contentType?: string | null;
    finalUrl?: string;
    hint?: string;
  } = { ok: false, url };

  // 1) HEAD
  try {
    const headRes = await fetch(url, { method: "HEAD", redirect: "follow" });

    out.status = headRes.status;
    out.finalUrl = headRes.url;
    out.contentType = headRes.headers.get("content-type");

    if (headRes.ok) {
      if (out.contentType && !out.contentType.toLowerCase().startsWith("image/")) {
        out.hint = `HEAD ok but content-type is not image/* (${out.contentType}).`;
      }
      out.ok = true;
      return out;
    }

    out.hint = `HEAD returned ${headRes.status}. If this URL is private/signed/expired, OpenAI can't fetch it.`;
  } catch (e: any) {
    out.hint = `HEAD failed (${e?.message ?? "unknown"}). Trying GET range...`;
  }

  // 2) GET range fallback
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
      if (out.contentType && !out.contentType.toLowerCase().startsWith("image/")) {
        out.hint = `GET ok but content-type is not image/* (${out.contentType}).`;
      }
      out.ok = true;
      return out;
    }

    out.hint = `GET returned ${getRes.status}. URL is not publicly fetchable.`;
    return out;
  } catch (e: any) {
    out.hint = `GET failed (${e?.message ?? "unknown"}). URL likely not accessible from server/OpenAI.`;
    return out;
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  let quoteLogId: string | null = null;

  try {
    const raw = await req.json().catch(() => null);

    // 1) Validate request
    const parsed = Req.safeParse(raw);
    if (!parsed.success) {
      return json(
        {
          ok: false,
          error: "BAD_REQUEST_VALIDATION",
          issues: parsed.error.issues,
          received: raw,
        },
        400
      );
    }

    const { tenantSlug, images, customer_context } = parsed.data;

    // 2) Tenant lookup
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return json(
        { ok: false, error: "TENANT_NOT_FOUND", message: `No tenant found for slug: ${tenantSlug}` },
        404
      );
    }

    // 3) Settings fetch (optional)
    const settingsRows = await db
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, (tenant as any).id))
      .limit(1);
    const settings = settingsRows[0] ?? null;

    // 4) OpenAI key
    const openAiKey = await getOpenAiKeyForTenant((tenant as any).id);
    if (!openAiKey) {
      return json(
        {
          ok: false,
          error: "OPENAI_KEY_MISSING",
          message: "No tenant OpenAI key found and OPENAI_API_KEY env var is not set.",
        },
        500
      );
    }

    // 5) Quote log (best effort)
    try {
      const inserted = await db
        .insert(quoteLogs)
        .values({
          tenantId: (tenant as any).id,
          requestJson: raw,
          status: "started",
        } as any)
        .returning({ id: (quoteLogs as any).id });

      quoteLogId = inserted?.[0]?.id ?? null;
    } catch {
      // ignore
    }

    // 6) Preflight images
    const checks = await Promise.all(images.map((img) => preflightImageUrl(img.url)));
    const bad = checks.filter((c) => !c.ok);

    if (bad.length > 0) {
      try {
        if (quoteLogId) {
          await db
            .update(quoteLogs)
            .set({
              status: "error",
              errorJson: { error: "IMAGE_URL_NOT_FETCHABLE", bad },
              durationMs: Date.now() - startedAt,
            } as any)
            .where(eq((quoteLogs as any).id, quoteLogId));
        }
      } catch {}

      return json(
        {
          ok: false,
          error: "IMAGE_URL_NOT_FETCHABLE",
          message:
            "At least one image URL is not publicly fetchable from the server. OpenAI will reject these. Fix these URLs first.",
          bad,
        },
        400
      );
    }

    // 7) OpenAI request (Responses API)
    const openai = new OpenAI({ apiKey: openAiKey });

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

    // IMPORTANT: Your SDK types REQUIRE `detail` on input images.
    // Also lock literal types with `as const` so TS doesn't widen them.
    const content = [
      { type: "input_text" as const, text: promptLines.join("\n") },
      ...images.map((img) => ({
        type: "input_image" as const,
        image_url: img.url,
        detail: "auto" as const,
      })),
    ];

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [{ role: "user", content }],
      text: { format: { type: "json_object" } },
    });

    // 8) Parse + validate output
    const rawText = response.output_text?.trim() || "";
    let structured: z.infer<typeof QuoteOutputSchema> | null = null;

    try {
      const obj = JSON.parse(rawText);
      const validated = QuoteOutputSchema.safeParse(obj);
      structured = validated.success ? validated.data : null;
    } catch {
      structured = null;
    }

    // 9) Update log (best effort)
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

    return json({
      ok: true,
      quoteLogId,
      tenantId: (tenant as any).id,
      settingsFound: !!settings,
      imagePreflight: checks,
      assessment: structured ?? {
        rawText,
        parse_warning: "Model did not return valid JSON per schema.",
      },
    });
  } catch (err: any) {
    const e = normalizeErr(err);

    try {
      if (quoteLogId) {
        await db
          .update(quoteLogs)
          .set({
            status: "error",
            errorJson: e,
            durationMs: Date.now() - startedAt,
          } as any)
          .where(eq((quoteLogs as any).id, quoteLogId));
      }
    } catch {}

    const status = e.status ?? 500;
    return json({ ok: false, error: "REQUEST_FAILED", ...e }, status);
  }
}
