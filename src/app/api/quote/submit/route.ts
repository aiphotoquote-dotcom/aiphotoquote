import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import OpenAI from "openai";

import { db } from "@/lib/db/client";
import { tenants, tenantSecrets, quoteLogs } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Req = z.object({
  tenantSlug: z.string().min(2),
  images: z
    .array(
      z.object({
        url: z.string().url(),
        shotType: z.string().optional(),
      })
    )
    .min(1)
    .max(12),
  customer_context: z
    .object({
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      notes: z.string().optional(),
      service_type: z.string().optional(),
      category: z.string().optional(),
    })
    .optional(),
  // IMPORTANT: render_opt_in belongs at TOP LEVEL
  render_opt_in: z.boolean().optional().default(false),
});

const QuoteOutputSchema = z.object({
  confidence: z.enum(["high", "medium", "low"]).optional(),
  inspection_required: z.boolean().optional(),
  summary: z.string().optional(),
  visible_scope: z.array(z.string()).optional(),
  assumptions: z.array(z.string()).optional(),
  questions: z.array(z.string()).optional(),
  estimate: z
    .object({
      low: z.number().optional(),
      high: z.number().optional(),
    })
    .optional(),
});

function jsonError(
  status: number,
  code: string,
  message: string,
  debugId?: string,
  extra?: any
) {
  return NextResponse.json(
    {
      ok: false,
      error: code,
      message,
      debugId,
      ...extra,
    },
    { status }
  );
}

function debugId() {
  return `dbg_${Math.random().toString(36).slice(2, 10)}`;
}

export async function POST(req: Request) {
  const dbg = debugId();

  try {
    const raw = await req.json().catch(() => null);
    const parsed = Req.safeParse(raw);

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "BAD_REQUEST",
          message: "Invalid payload",
          issues: parsed.error.issues,
          debugId: dbg,
        },
        { status: 400 }
      );
    }

    const { tenantSlug, images, customer_context, render_opt_in } = parsed.data;

    // 1) Tenant lookup (NO db.query usage)
    const tenantRow = await db
      .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.slug, tenantSlug))
      .limit(1);

    const tenant = tenantRow[0];
    if (!tenant) {
      return jsonError(404, "TENANT_NOT_FOUND", "Invalid tenant link.", dbg);
    }

    // 2) Fetch tenant OpenAI key (encrypted)
    const secretRows = await db
      .select({
        tenantId: tenantSecrets.tenantId,
        openaiKeyEnc: tenantSecrets.openaiKeyEnc,
      })
      .from(tenantSecrets)
      .where(eq(tenantSecrets.tenantId, tenant.id))
      .limit(1);

    const secret = secretRows[0];
    if (!secret?.openaiKeyEnc) {
      return jsonError(
        400,
        "TENANT_OPENAI_KEY_MISSING",
        "This tenant has not configured an OpenAI key yet.",
        dbg
      );
    }

    const openaiKey = decryptSecret(secret.openaiKeyEnc);
    if (!openaiKey) {
      return jsonError(
        500,
        "TENANT_OPENAI_KEY_DECRYPT_FAILED",
        "Could not decrypt tenant OpenAI key (check platform encryption key).",
        dbg
      );
    }

    const openai = new OpenAI({ apiKey: openaiKey });

    // 3) Prepare prompt
    const notes = customer_context?.notes?.trim() || "";
    const category = customer_context?.category?.trim() || "service";
    const serviceType = customer_context?.service_type?.trim() || "";

    const prompt = [
      `You are an expert estimator for a service business.`,
      `Return JSON only.`,
      ``,
      `Context:`,
      `- category: ${category}`,
      serviceType ? `- service_type: ${serviceType}` : null,
      notes ? `- notes: ${notes}` : null,
      ``,
      `Analyze the provided photos and give: confidence, inspection_required, summary, questions[], estimate{low,high}.`,
      `Make estimate conservative and realistic.`,
    ]
      .filter(Boolean)
      .join("\n");

    const visionInput = images.map((img) => ({
      type: "image_url",
      image_url: { url: img.url },
    }));

    // 4) Call OpenAI (cast to any to avoid SDK type churn for vision parts)
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" } as any,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }, ...(visionInput as any)],
        },
      ],
    });

    const content = completion.choices?.[0]?.message?.content || "{}";
    let out: any;
    try {
      out = JSON.parse(content);
    } catch {
      out = { raw: content };
    }

    const normalized = QuoteOutputSchema.safeParse(out);
    const output = normalized.success ? normalized.data : out;

    const confidence = (output as any)?.confidence ?? null;
    const inspectionRequired =
      typeof (output as any)?.inspection_required === "boolean"
        ? Boolean((output as any)?.inspection_required)
        : null;

    const estimateLow =
      typeof (output as any)?.estimate?.low === "number"
        ? Math.round((output as any).estimate.low)
        : null;

    const estimateHigh =
      typeof (output as any)?.estimate?.high === "number"
        ? Math.round((output as any).estimate.high)
        : null;

    // 5) Write quote_logs (input/output are NOT NULL in prod DB)
    const inputPayload = {
      tenantSlug,
      images,
      customer_context: customer_context ?? null,
      render_opt_in: Boolean(render_opt_in),
      createdAt: new Date().toISOString(),
    };

    const renderOptIn = Boolean(render_opt_in);
    const renderStatus = renderOptIn ? "queued" : "not_requested";

    const inserted = await db
      .insert(quoteLogs)
      .values({
        tenantId: tenant.id,
        input: inputPayload,
        output: output ?? {},

        confidence: confidence ? String(confidence) : null,
        estimateLow: estimateLow ?? null,
        estimateHigh: estimateHigh ?? null,
        inspectionRequired: inspectionRequired ?? null,

        renderOptIn,
        renderStatus,
      })
      .returning({ id: quoteLogs.id });

    const quoteLogId = inserted?.[0]?.id;

    return NextResponse.json(
      {
        ok: true,
        tenantId: tenant.id,
        quoteLogId,
        output,
        render_opt_in: renderOptIn,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("QUOTE_SUBMIT_ERROR", { debugId: dbg, err });
    return jsonError(
      500,
      "REQUEST_FAILED",
      err?.message ?? "Unknown error",
      dbg,
      err?.cause ? { cause: String(err.cause) } : undefined
    );
  }
}
