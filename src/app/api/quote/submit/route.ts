// src/app/api/quote/submit/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import OpenAI from "openai";

import { db } from "@/lib/db/client";
import { tenants, quoteLogs } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * IMPORTANT CONTRACT:
 * - We accept render_opt_in at TOP LEVEL (so it can be saved into quote_logs.input.render_opt_in).
 * - We DO NOT force render_opt_in into customer_context (keep customer_context purely customer-facing).
 * - On submit, we ONLY insert what we actually know now:
 *     tenant_id, input, output, confidence, estimate_low/high, inspection_required, render_opt_in
 *   Everything else (render_status, timestamps, render_* fields) should default in DB and be updated later.
 */

const Req = z.object({
  tenantSlug: z.string().min(2),
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
    })
    .optional(),

  contact: z
    .object({
      name: z.string().min(1),
      email: z.string().email(),
      phone: z.string().min(7),
    })
    .optional(),

  // ✅ top-level render opt in
  render_opt_in: z.boolean().optional().default(false),
});

function jsonErr(message: string, init?: { status?: number; debugId?: string; code?: string; extra?: any }) {
  return NextResponse.json(
    {
      ok: false,
      error: init?.code || "REQUEST_FAILED",
      message,
      debugId: init?.debugId,
      ...((init?.extra ?? null) ? { extra: init!.extra } : {}),
    },
    { status: init?.status ?? 500 }
  );
}

function safeAnyJson(x: unknown) {
  try {
    return JSON.parse(JSON.stringify(x ?? null));
  } catch {
    return null;
  }
}

function buildPrompt(args: {
  tenantSlug: string;
  images: Array<{ url: string; shotType?: string }>;
  customer_context?: any;
  contact?: any;
}) {
  const { tenantSlug, images, customer_context, contact } = args;

  return `
You are an expert estimator for upholstery/service work. Given the photos and the customer's note, return a JSON object with:

{
  "confidence": "high" | "medium" | "low",
  "inspection_required": boolean,
  "summary": string,
  "questions": string[],
  "estimate": { "low": number, "high": number }
}

Rules:
- Be conservative; if unsure, set inspection_required true.
- Questions should be short and actionable.
- estimate.low/high must be integers (USD).
- Do not include markdown. Output JSON only.

Context:
tenantSlug: ${tenantSlug}
customer_context: ${JSON.stringify(customer_context ?? {}, null, 2)}
contact: ${JSON.stringify(contact ?? {}, null, 2)}
images: ${JSON.stringify(images, null, 2)}
`.trim();
}

export async function POST(req: Request) {
  const debugId = `dbg_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

  try {
    const body = await req.json().catch(() => null);
    const parsed = Req.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "BAD_REQUEST",
          message: "Invalid request payload",
          debugId,
          issues: parsed.error.issues,
        },
        { status: 400 }
      );
    }

    const { tenantSlug, images, customer_context, contact, render_opt_in } = parsed.data;

    // ---- tenant lookup (avoid db.query.* so you don't need drizzle schema generics)
    const t = await db
      .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.slug, tenantSlug))
      .limit(1);

    const tenant = t?.[0];
    if (!tenant?.id) {
      return jsonErr(`Unknown tenant slug: ${tenantSlug}`, {
        status: 404,
        debugId,
        code: "TENANT_NOT_FOUND",
      });
    }

    // ---- OpenAI vision input
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const prompt = buildPrompt({ tenantSlug, images, customer_context, contact });

    // OpenAI chat content parts typing can be strict; cast to any to keep TS happy.
    const visionInput = images.map((img) => ({
      type: "image_url",
      image_url: { url: img.url },
    })) as any[];

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_VISION_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt } as any,
            ...visionInput,
          ] as any,
        },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content ?? "";
    let output: any = null;

    try {
      // try parse JSON directly
      output = raw ? JSON.parse(raw) : null;
    } catch {
      // fallback: best-effort wrap
      output = { confidence: "low", inspection_required: true, summary: String(raw).slice(0, 2000), questions: [], estimate: { low: 0, high: 0 } };
    }

    const confidence = String(output?.confidence ?? "low");
    const inspection_required = Boolean(output?.inspection_required ?? true);
    const estimateLow = Number.isFinite(Number(output?.estimate?.low)) ? Math.round(Number(output.estimate.low)) : null;
    const estimateHigh = Number.isFinite(Number(output?.estimate?.high)) ? Math.round(Number(output.estimate.high)) : null;

    // ---- Build input JSON saved to DB
    const input = safeAnyJson({
      tenantSlug,
      images,
      customer_context: customer_context ?? null,
      contact: contact ?? null,
      render_opt_in: Boolean(render_opt_in),
      createdAt: new Date().toISOString(),
    });

    const outputJson = safeAnyJson(output);

    // ✅ THE FIX: ONLY insert the fields we know now. Let DB defaults handle the rest.
    const inserted = await db
      .insert(quoteLogs)
      .values({
        tenantId: tenant.id,
        input,
        output: outputJson,
        confidence,
        estimateLow: estimateLow ?? undefined,
        estimateHigh: estimateHigh ?? undefined,
        inspectionRequired: inspection_required,
        renderOptIn: Boolean(render_opt_in),
      })
      .returning({ id: quoteLogs.id });

    const quoteLogId = inserted?.[0]?.id ?? null;

    return NextResponse.json(
      {
        ok: true,
        quoteLogId,
        tenantId: tenant.id,
        output: outputJson,
        render_opt_in: Boolean(render_opt_in),
      },
      { status: 200 }
    );
  } catch (err: any) {
    // make sure we return useful debug data like your UI shows
    const message = err?.message ? String(err.message) : String(err);
    return NextResponse.json(
      {
        ok: false,
        error: "REQUEST_FAILED",
        message: `Failed query: ${message}`,
        debugId,
        // keep a small hint, never dump giant stacks to client
        hint: message.includes("insert into quote_logs")
          ? "Insert mismatch. Ensure quote_logs columns match drizzle schema and do not force defaults."
          : undefined,
      },
      { status: 500 }
    );
  }
}
