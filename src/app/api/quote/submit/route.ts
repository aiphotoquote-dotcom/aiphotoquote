import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import OpenAI from "openai";

import { db } from "@/lib/db/client";
import { tenants, tenantSecrets, tenantSettings, quoteLogs } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";

/**
 * Request payload must look like:
 * {
 *   tenantSlug: "maggio-upholstery",
 *   images: [{ url: "https://..." }, ...],
 *   customer_context: { notes?: "...", service_type?: "...", category?: "marine" }
 * }
 */
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

// Keep your output schema if you already had one elsewhere.
// For now, return a basic structured object plus raw text.
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
 * Attempts to fetch/decrypt tenant-scoped OpenAI API key.
 * Falls back to process.env.OPENAI_API_KEY.
 *
 * IMPORTANT: this assumes your tenantSecrets table has at least:
 * - tenant_id
 * - key (string)
 * - value_encrypted (or similar) -> whatever decryptSecret expects
 *
 * If your column names differ, adjust ONLY inside this function.
 */
async function getOpenAiKeyForTenant(tenantId: string) {
  // Try a couple common key names to reduce breakage.
  const keyCandidates = ["openai_api_key", "OPENAI_API_KEY"];

  for (const k of keyCandidates) {
    const secretRows = await db
      .select()
      .from(tenantSecrets)
      .where(and(eq(tenantSecrets.tenantId, tenantId), eq(tenantSecrets.key, k)))
      .limit(1);

    const secret = secretRows[0];
    if (secret) {
      // You may need to change "secret.valueEncrypted" to your actual encrypted column.
      const encrypted =
        (secret as any).valueEncrypted ??
        (secret as any).value_encrypted ??
        (secret as any).encryptedValue ??
        (secret as any).encrypted_value;

      if (!encrypted) break;

      const decrypted = decryptSecret(encrypted);
      if (decrypted) return decrypted;
    }
  }

  return process.env.OPENAI_API_KEY || null;
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  let quoteLogId: string | null = null;

  try {
    const raw = await req.json().catch(() => null);

    // 1) Validate request body
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

    // 2) Resolve tenant
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return json(
        { ok: false, error: "TENANT_NOT_FOUND", message: `No tenant found for slug: ${tenantSlug}` },
        404
      );
    }

    // 3) (Optional) settings fetch — DO NOT fail request if missing
    // This is just helpful context; you were seeing tenant_settings errors earlier.
    const settingsRows = await db
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, (tenant as any).id))
      .limit(1);
    const settings = settingsRows[0] ?? null;

    // 4) Get OpenAI key (tenant secret -> env fallback)
    const openAiKey = await getOpenAiKeyForTenant((tenant as any).id);
    if (!openAiKey) {
      return json(
        {
          ok: false,
          error: "OPENAI_KEY_MISSING",
          message: "No OpenAI API key found for tenant and OPENAI_API_KEY env var is not set.",
        },
        500
      );
    }

    // 5) Create log row (best effort)
    try {
      const inserted = await db
        .insert(quoteLogs)
        .values({
          tenantId: (tenant as any).id,
          // You may need to align these fields to your schema.
          // Keeping it minimal + resilient:
          requestJson: raw,
          status: "started",
        } as any)
        .returning({ id: (quoteLogs as any).id });

      quoteLogId = inserted?.[0]?.id ?? null;
    } catch {
      // do nothing — don’t block quoting if logging fails
    }

    // 6) Build OpenAI request using Responses API (vision-friendly)
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
      "visible_scope: string[] (bullet-like items)",
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

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      // IMPORTANT: input must be correct for images
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: promptLines.join("\n") },
            ...images.map((img) => ({
              type: "input_image",
              image_url: img.url,
            })),
          ],
        },
      ],
      // Encourage strict JSON output
      text: { format: { type: "json_object" } },
    });

    // 7) Parse output text into our schema (best effort)
    const rawText = response.output_text?.trim() || "";
    let structured: z.infer<typeof QuoteOutputSchema> | null = null;

    try {
      const jsonParsed = JSON.parse(rawText);
      const validated = QuoteOutputSchema.safeParse(jsonParsed);
      structured = validated.success ? validated.data : null;
    } catch {
      structured = null;
    }

    // 8) Update log row (best effort)
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
      assessment: structured ?? { rawText, parse_warning: "Model did not return valid JSON per schema." },
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
    return json(
      {
        ok: false,
        error: "REQUEST_FAILED",
        ...e,
      },
      status
    );
  }
}
