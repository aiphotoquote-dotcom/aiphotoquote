import { NextResponse } from "next/server";
import { z } from "zod";
import OpenAI from "openai";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants, tenantSecrets, quoteLogs } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";

/**
 * Zod v4 requires key + value schema for record()
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

  customer_context: z.record(z.string(), z.any()).optional(),
  render_opt_in: z.boolean().optional().default(false),
});

function debugId() {
  return `dbg_${Math.random().toString(36).slice(2, 10)}`;
}

function ok(data: any) {
  return NextResponse.json({ ok: true, ...data });
}

function fail(message: string, dbg: string, status = 500) {
  return NextResponse.json(
    { ok: false, error: { code: "REQUEST_FAILED" }, message, debugId: dbg },
    { status }
  );
}

function buildPrompt({
  tenantSlug,
  images,
  customer_context,
}: {
  tenantSlug: string;
  images: { url: string; shotType?: string }[];
  customer_context?: Record<string, any>;
}) {
  const notes = String(customer_context?.notes ?? "");
  const category = String(
    customer_context?.service_type ??
      customer_context?.category ??
      "service"
  );

  return `
You are an expert estimator for ${tenantSlug}.

Return STRICT JSON only:
{
  "confidence": "high" | "medium" | "low",
  "inspection_required": boolean,
  "summary": string,
  "questions": string[],
  "estimate": { "low": number, "high": number }
}

Rules:
- This is an estimate range, not a final quote
- Be conservative if unsure
- Ask clear follow-up questions if needed

Category: ${category}
Notes: ${notes || "(none)"}

Photos:
${images
  .map((i, idx) => `- ${idx + 1}. ${i.shotType ?? "photo"}: ${i.url}`)
  .join("\n")}
`.trim();
}

export async function POST(req: Request) {
  const dbg = debugId();

  try {
    const body = await req.json().catch(() => null);
    const parsed = Req.safeParse(body);

    if (!parsed.success) {
      return fail("Invalid request payload", dbg, 400);
    }

    const { tenantSlug, images, customer_context, render_opt_in } = parsed.data;

    /* ---------------- tenant lookup ---------------- */
    const tenantRow = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, tenantSlug))
      .limit(1);

    const tenantId = tenantRow[0]?.id;
    if (!tenantId) {
      return fail("Tenant not found", dbg, 404);
    }

    /* -------- tenant OpenAI key (customer-owned) -------- */
    const secretRow = await db
      .select({ enc: tenantSecrets.openaiKeyEnc })
      .from(tenantSecrets)
      .where(eq(tenantSecrets.tenantId, tenantId))
      .limit(1);

    if (!secretRow[0]?.enc) {
      return fail(
        "Tenant OpenAI key missing. Configure it in tenant settings.",
        dbg,
        400
      );
    }

    const openai = new OpenAI({
      apiKey: decryptSecret(secretRow[0].enc),
    });

    const prompt = buildPrompt({ tenantSlug, images, customer_context });

    const visionParts = images.map((img) => ({
      type: "image_url",
      image_url: { url: img.url },
    }));

    const completion: any = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }, ...visionParts],
        },
      ],
    } as any);

    let outputJson: any;
    try {
      outputJson = JSON.parse(
        completion?.choices?.[0]?.message?.content ?? "{}"
      );
    } catch {
      outputJson = {
        confidence: "low",
        inspection_required: true,
        summary:
          "Unable to confidently estimate from photos. Inspection recommended.",
        questions: [],
        estimate: { low: 0, high: 0 },
      };
    }

    /* ---------------- DB INSERT (MATCHES REAL TABLE) ---------------- */
    const insert = await db
      .insert(quoteLogs)
      .values({
        tenantId,
        input: {
          tenantSlug,
          images,
          customer_context: customer_context ?? {},
          render_opt_in,
          createdAt: new Date().toISOString(),
        },
        output: outputJson,
        renderOptIn: render_opt_in,
        renderStatus: render_opt_in ? "queued" : "not_requested",
      })
      .returning({ id: quoteLogs.id });

    return ok({
      quoteLogId: insert[0]?.id ?? null,
      output: outputJson,
      render_opt_in,
      debugId: dbg,
    });
  } catch (err: any) {
    return fail(err?.message ?? "Unhandled server error", dbg);
  }
}
