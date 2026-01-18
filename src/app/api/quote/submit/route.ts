import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import OpenAI from "openai";

import { db } from "@/lib/db/client";
import { tenants, tenantSecrets, quoteLogs } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";

/**
 * Request schema
 */
const Req = z.object({
  tenantSlug: z.string().min(2),
  images: z.array(
    z.object({
      url: z.string().url(),
      shotType: z.enum(["wide", "closeup", "extra"]),
    })
  ),
  customer_context: z
    .object({
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      notes: z.string().optional(),
      category: z.string().optional(),
      service_type: z.string().optional(),
    })
    .optional(),
  render_opt_in: z.boolean().optional().default(false),
});

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = Req.safeParse(body);

    if (!parsed.success) {
      return json(
        { ok: false, error: "BAD_REQUEST", issues: parsed.error.issues },
        400
      );
    }

    const { tenantSlug, images, customer_context, render_opt_in } = parsed.data;

    // ------------------------------------------------------------
    // 1) Tenant lookup (NO db.query usage — avoids schema-generic TS errors)
    // ------------------------------------------------------------
    const tenant = await db
      .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.slug, tenantSlug))
      .limit(1)
      .then((rows) => rows[0]);

    if (!tenant) {
      return json({ ok: false, error: "TENANT_NOT_FOUND" }, 404);
    }

    // ------------------------------------------------------------
    // 2) Tenant OpenAI key lookup (NO db.query usage)
    // ------------------------------------------------------------
    const secretRow = await db
      .select({ openaiKeyEnc: tenantSecrets.openaiKeyEnc })
      .from(tenantSecrets)
      .where(eq(tenantSecrets.tenantId, tenant.id))
      .limit(1)
      .then((rows) => rows[0]);

    if (!secretRow?.openaiKeyEnc) {
      return json(
        {
          ok: false,
          error: "TENANT_OPENAI_KEY_MISSING",
          message: "Tenant has not configured an OpenAI API key yet.",
        },
        400
      );
    }

    const openaiKey = decryptSecret(secretRow.openaiKeyEnc);
    const openai = new OpenAI({ apiKey: openaiKey });

    // ------------------------------------------------------------
    // 3) Prompt (keep stable for sellable SaaS)
    // ------------------------------------------------------------
    const prompt = `
You are an expert upholstery estimator.

Analyze the provided images and notes.
Return a JSON object with:
- confidence ("high" | "medium" | "low")
- inspection_required (boolean)
- summary (string)
- questions (array of strings)
- estimate { low: number, high: number }

Be conservative, professional, and avoid overpromising.
`.trim();

    // Fix OpenAI content-part typing with `as const`
    const visionParts = images.map((img) => ({
      type: "image_url" as const,
      image_url: { url: img.url },
    }));

    // ------------------------------------------------------------
    // 4) OpenAI call
    // ------------------------------------------------------------
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [{ type: "text" as const, text: prompt }, ...visionParts],
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = completion.choices?.[0]?.message?.content ?? "{}";
    let aiOutput: any = {};
    try {
      aiOutput = JSON.parse(content);
    } catch {
      aiOutput = { raw: content };
    }

    // ------------------------------------------------------------
    // 5) Persist quote_logs (MATCHES YOUR ACTUAL DB: jsonb input/output)
    // ------------------------------------------------------------
    const inputPayload = {
      tenantSlug,
      images,
      customer_context: customer_context ?? {},
      render_opt_in: Boolean(render_opt_in),
      createdAt: new Date().toISOString(),
    };

    const renderOptIn = Boolean(render_opt_in);

    const [row] = await db
      .insert(quoteLogs)
      .values({
        tenantId: tenant.id,
        input: inputPayload,
        output: aiOutput,
        renderOptIn,
        renderStatus: renderOptIn ? "queued" : "not_requested",
      })
      .returning({ id: quoteLogs.id });

    // ------------------------------------------------------------
    // 6) Response
    // ------------------------------------------------------------
    return json({
      ok: true,
      quoteLogId: row?.id,
      tenantId: tenant.id,
      output: aiOutput,
      render_opt_in: renderOptIn,
    });
  } catch (err: any) {
    console.error("QUOTE_SUBMIT_ERROR", err);
    return json(
      {
        ok: false,
        error: "REQUEST_FAILED",
        message: err?.message ?? "Unknown error",
      },
      500
    );
  }
}
