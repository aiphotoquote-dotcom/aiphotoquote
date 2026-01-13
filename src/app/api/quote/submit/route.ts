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
  return {
    name: err?.name,
    message: err?.message ?? String(err),
    status: typeof err?.status === "number" ? err.status : undefined,
    code: err?.code,
    type: err?.type,
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
 *
 * So we fetch by tenantId and decrypt openaiKeyEnc.
 * Fallback to process.env.OPENAI_API_KEY if not present.
 */
async function getOpenAiKeyForTenant(tenantId: string) {
  const rows = await db.select().from(tenantSecrets).where(eq(tenantSecrets.tenantId, tenantId)).limit(1);
  const secret = rows[0] ?? null;

  const enc = secret ? (secret as any).openaiKeyEnc : null;
  const dec = enc ? decryptSecret(enc) : null;

  return dec || process.env.OPENAI_API_KEY || null;
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

    // 3) Settings fetch (optional, don't fail if missing)
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

    // 5) Create quote log (best effort)
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
      // don't block
    }

    // 6) Build OpenAI request (Responses API)
    const openai = new OpenAI({ apiKey: openAiKey });

    const notes = customer_context?.notes?.trim();
    const serviceType = customer_context?.service_type?.trim();
    const category = customer_context?.category?.trim();

    const promptLines = [
      "You are an expert marine + auto upholstery estimator.",
      "Analyze the photos and return a JSON object with:",
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

    // IMPORTANT: Your OpenAI SDK types require `detail` on input images.
    // Also ensure literal types with `as const` to avoid widening to `string`.
    const content = [
      { type: "input_text" as const, text: promptLines.join("\n") },
      ...images.map((img) => ({
        type: "input_image" as const,
        image_url: img.url,
        detail: "auto" as const, // REQUIRED by your installed SDK typings
      })),
    ];

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [{ role: "user", content }],
      text: { format: { type: "json_object" } },
    });

    // 7) Parse + validate output
    const rawText = response.output_text?.trim() || "";
    let structured: z.infer<typeof QuoteOutputSchema> | null = null;

    try {
      const obj = JSON.parse(rawText);
      const validated = QuoteOutputSchema.safeParse(obj);
      structured = validated.success ? validated.data : null;
    } catch {
      structured = null;
    }

    // 8) Update quote log (best effort)
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
    } catch {
      // ignore
    }

    return json({
      ok: true,
      quoteLogId,
      tenantId: (tenant as any).id,
      settingsFound: !!settings,
      assessment: structured ?? {
        rawText,
        parse_warning: "Model did not return valid JSON per schema.",
      },
    });
  } catch (err: any) {
    const e = normalizeErr(err);

    // Update log row (best effort)
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
    } catch {
      // ignore
    }

    const status = e.status ?? 500;
    return json({ ok: false, error: "REQUEST_FAILED", ...e }, status);
  }
}
