import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import OpenAI from "openai";

import { db } from "@/lib/db/client";
import { tenants, tenantSecrets, quoteLogs } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ------------------------- Request schema ------------------------- */

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
  render_opt_in: z.boolean().optional().default(false),
});

function debugId() {
  return `dbg_${Math.random().toString(36).slice(2, 10)}`;
}

function jsonError(
  status: number,
  code: string,
  message: string,
  debugId?: string,
  extra?: any
) {
  return NextResponse.json(
    { ok: false, error: code, message, debugId, ...extra },
    { status }
  );
}

/* ------------------------------ POST ------------------------------ */

export async function POST(req: Request) {
  const dbg = debugId();

  try {
    const raw = await req.json().catch(() => null);
    const parsed = Req.safeParse(raw);

    if (!parsed.success) {
      return jsonError(
        400,
        "BAD_REQUEST",
        "Invalid payload",
        dbg,
        { issues: parsed.error.issues }
      );
    }

    const { tenantSlug, images, customer_context, render_opt_in } = parsed.data;

    /* -------- Tenant lookup -------- */

    const tenantRow = await db
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.slug, tenantSlug))
      .limit(1);

    const tenant = tenantRow[0];
    if (!tenant) {
      return jsonError(404, "TENANT_NOT_FOUND", "Invalid tenant link.", dbg);
    }

    /* -------- Tenant OpenAI key -------- */

    const secretRow = await db
      .select({ openaiKeyEnc: tenantSecrets.openaiKeyEnc })
      .from(tenantSecrets)
      .where(eq(tenantSecrets.tenantId, tenant.id))
      .limit(1);

    const secret = secretRow[0];
    if (!secret?.openaiKeyEnc) {
      return jsonError(
        400,
        "TENANT_OPENAI_KEY_MISSING",
        "Tenant has not configured an OpenAI key.",
        dbg
      );
    }

    const openaiKey = decryptSecret(secret.openaiKeyEnc);
    if (!openaiKey) {
      return jsonError(
        500,
        "TENANT_OPENAI_KEY_DECRYPT_FAILED",
        "Failed to decrypt tenant OpenAI key.",
        dbg
      );
    }

    const openai = new OpenAI({ apiKey: openaiKey });

    /* -------- Prompt -------- */

    const notes = customer_context?.notes?.trim() || "";
    const category = customer_context?.category || "service";

    const prompt = `
You are an expert service estimator.

Return JSON ONLY.

Context:
- category: ${category}
${notes ? `- notes: ${notes}` : ""}

From the photos, estimate:
- confidence (high|medium|low)
- inspection_required (boolean)
- summary
- questions (array)
- estimate { low, high }
`.trim();

    const visionInput = images.map((img) => ({
      type: "image_url",
      image_url: { url: img.url },
    }));

    /* -------- OpenAI call -------- */

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

    let output: any = {};
    try {
      output = JSON.parse(
        completion.choices?.[0]?.message?.content || "{}"
      );
    } catch {
      output = { raw: completion.choices?.[0]?.message?.content };
    }

    /* -------- Persist quote (MATCHES REAL DB) -------- */

    const inputPayload = {
      tenantSlug,
      images,
      customer_context: customer_context ?? null,
      render_opt_in: Boolean(render_opt_in),
      createdAt: new Date().toISOString(),
    };

    const renderOptIn = Boolean(render_opt_in);

    const inserted = await db
      .insert(quoteLogs)
      .values({
        tenantId: tenant.id,
        input: inputPayload,
        output,
        renderOptIn,
        renderStatus: renderOptIn ? "queued" : "not_requested",
      })
      .returning({ id: quoteLogs.id });

    return NextResponse.json(
      {
        ok: true,
        quoteLogId: inserted[0]?.id,
        output,
        render_opt_in: renderOptIn,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("QUOTE_SUBMIT_ERROR", { dbg, err });
    return jsonError(
      500,
      "REQUEST_FAILED",
      err?.message || "Unknown error",
      dbg
    );
  }
}
