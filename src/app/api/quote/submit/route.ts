import { NextResponse } from "next/server";
import { z } from "zod";
import OpenAI from "openai";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants, tenantSecrets, quoteLogs } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";

/**
 * NOTE (Zod v4):
 * z.record() requires (keySchema, valueSchema) in this build.
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

  // flexible bag of fields from the form
  customer_context: z.record(z.string(), z.any()).optional(),

  // opt-in stored at top-level
  render_opt_in: z.boolean().optional().default(false),
});

function debugId() {
  return `dbg_${Math.random().toString(36).slice(2, 10)}${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function jsonOk(data: any, init?: ResponseInit) {
  return NextResponse.json({ ok: true, ...data }, init);
}

function jsonErr(message: string, extra?: any, init?: ResponseInit) {
  return NextResponse.json(
    { ok: false, error: { code: "REQUEST_FAILED" }, message, ...extra },
    init ?? { status: 500 }
  );
}

function buildPrompt(args: {
  tenantSlug: string;
  images: Array<{ url: string; shotType?: string }>;
  customer_context?: Record<string, any>;
}) {
  const { tenantSlug, images, customer_context } = args;

  const notes = String(customer_context?.notes ?? "").trim();
  const category = String(customer_context?.category ?? customer_context?.service_type ?? "service").trim();

  // Keep prompt tight + deterministic: we're estimating and producing structured JSON
  return `
You are an expert service estimator for ${tenantSlug}.
You will analyze the uploaded photos and any customer notes.

Return STRICT JSON only (no markdown, no commentary) matching this shape:
{
  "confidence": "high" | "medium" | "low",
  "inspection_required": boolean,
  "summary": string,
  "questions": string[],
  "estimate": { "low": number, "high": number }
}

Guidelines:
- This is a rough estimate range and may require inspection.
- Ask a few short, practical follow-up questions if needed.
- If you cannot tell enough from the photos, set inspection_required=true and confidence="low".
- Keep summary customer-friendly.

Customer context:
- category: ${category || "service"}
- notes: ${notes || "(none)"}

Photo list (shotType is user-labeled hint):
${images
  .map((im, i) => `- ${i + 1}. ${im.shotType ? `[${im.shotType}] ` : ""}${im.url}`)
  .join("\n")}
`.trim();
}

export async function POST(req: Request) {
  const dbg = debugId();

  try {
    const body = await req.json().catch(() => null);
    const parsed = Req.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "BAD_REQUEST" },
          message: "Invalid request",
          issues: parsed.error.issues,
          debugId: dbg,
        },
        { status: 400 }
      );
    }

    const { tenantSlug, images, customer_context, render_opt_in } = parsed.data;

    // --- Tenant lookup (NO db.query usage; works even if schema generic missing) ---
    const tenantRows = await db
      .select({ id: tenants.id, slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.slug, tenantSlug))
      .limit(1);

    const tenant = tenantRows[0];
    if (!tenant?.id) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "TENANT_NOT_FOUND" },
          message: `Unknown tenantSlug: ${tenantSlug}`,
          debugId: dbg,
        },
        { status: 404 }
      );
    }

    // --- Fetch TENANT OpenAI key (customer/tenant key, not platform key) ---
    const secretRows = await db
      .select({ openaiKeyEnc: tenantSecrets.openaiKeyEnc })
      .from(tenantSecrets)
      .where(eq(tenantSecrets.tenantId, tenant.id))
      .limit(1);

    const secret = secretRows[0];
    if (!secret?.openaiKeyEnc) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "TENANT_SECRET_MISSING" },
          message:
            "Tenant OpenAI key is not configured. Ask the tenant admin to add their OpenAI key in Settings.",
          debugId: dbg,
        },
        { status: 400 }
      );
    }

    const tenantOpenAiKey = decryptSecret(secret.openaiKeyEnc);

    const openai = new OpenAI({ apiKey: tenantOpenAiKey });

    const prompt = buildPrompt({ tenantSlug, images, customer_context });

    // Build vision content parts
    const visionParts = images.map((im) => ({
      type: "image_url",
      image_url: { url: im.url },
    }));

    // --- Call OpenAI (cast to any to avoid type mismatch across SDK versions) ---
    const completion: any = await openai.chat.completions.create(
      {
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: prompt }, ...visionParts],
          },
        ],
      } as any
    );

    const rawText =
      completion?.choices?.[0]?.message?.content ??
      completion?.output_text ??
      "";

    // Parse JSON safely
    let aiJson: any = null;
    try {
      aiJson = typeof rawText === "string" ? JSON.parse(rawText) : rawText;
    } catch {
      // If the model returns non-JSON, store it and mark as low confidence
      aiJson = {
        confidence: "low",
        inspection_required: true,
        summary:
          "We were unable to generate a clean estimate from the photos. An inspection is required.",
        questions: ["What exactly would you like restored or replaced?"],
        estimate: { low: 0, high: 0 },
        _raw: rawText,
      };
    }

    // Normalize expected fields
    const normalized = {
      confidence: String(aiJson?.confidence ?? "low"),
      inspection_required: Boolean(aiJson?.inspection_required ?? true),
      summary: String(aiJson?.summary ?? ""),
      questions: Array.isArray(aiJson?.questions)
        ? aiJson.questions.map((x: any) => String(x)).filter(Boolean)
        : [],
      estimate: {
        low: Number(aiJson?.estimate?.low ?? 0),
        high: Number(aiJson?.estimate?.high ?? 0),
      },
    };

    // --- DB insert (match your actual quote_logs schema) ---
    const inputPayload = {
      tenantSlug,
      images,
      customer_context: customer_context ?? {},
      render_opt_in: Boolean(render_opt_in),
      createdAt: new Date().toISOString(),
    };

    const outputPayload = {
      ...normalized,
      render_opt_in: Boolean(render_opt_in),
    };

    const inserted = await db
      .insert(quoteLogs)
      .values({
        tenantId: tenant.id,
        input: inputPayload as any,
        output: outputPayload as any,
        renderOptIn: Boolean(render_opt_in),
        renderStatus: Boolean(render_opt_in) ? "queued" : "not_requested",
      })
      .returning({ id: quoteLogs.id });

    const quoteLogId = inserted?.[0]?.id ?? null;

    return jsonOk({
      quoteLogId,
      tenantId: tenant.id,
      output: outputPayload,
      render_opt_in: Boolean(render_opt_in),
      debugId: dbg,
    });
  } catch (e: any) {
    const msg = e?.message ? String(e.message) : "Unknown error";
    return jsonErr(msg, { debugId: dbg }, { status: 500 });
  }
}
