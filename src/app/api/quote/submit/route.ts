import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import OpenAI from "openai";

import { db } from "@/lib/db/client";
import { tenants, tenantSecrets, quoteLogs } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";

/* ---------------- schema ---------------- */

const Req = z.object({
  tenantSlug: z.string(),
  images: z.array(
    z.object({
      url: z.string().url(),
      shotType: z.enum(["wide", "closeup", "extra"]),
    })
  ),
  customer_context: z.record(z.any()).optional(),
  render_opt_in: z.boolean().optional().default(false),
});

/* ---------------- handler ---------------- */

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = Req.parse(body);

    /* 1. tenant */
    const tenant = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, parsed.tenantSlug))
      .limit(1)
      .then((r) => r[0]);

    if (!tenant) {
      return NextResponse.json(
        { ok: false, error: "TENANT_NOT_FOUND" },
        { status: 404 }
      );
    }

    /* 2. tenant OpenAI key */
    const secret = await db
      .select({ openaiKeyEnc: tenantSecrets.openaiKeyEnc })
      .from(tenantSecrets)
      .where(eq(tenantSecrets.tenantId, tenant.id))
      .limit(1)
      .then((r) => r[0]);

    if (!secret) {
      return NextResponse.json(
        { ok: false, error: "TENANT_OPENAI_KEY_MISSING" },
        { status: 400 }
      );
    }

    const openai = new OpenAI({
      apiKey: decryptSecret(secret.openaiKeyEnc),
    });

    /* 3. OpenAI */
    const prompt = `You are an upholstery estimator. Return JSON only.`;

    const vision = parsed.images.map((img) => ({
      type: "image_url" as const,
      image_url: { url: img.url },
    }));

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [{ type: "text" as const, text: prompt }, ...vision],
        },
      ],
    });

    const output = JSON.parse(
      completion.choices[0]?.message?.content ?? "{}"
    );

    /* 4. persist — JSON ONLY (matches DB exactly) */
    const [row] = await db
      .insert(quoteLogs)
      .values({
        tenantId: tenant.id,
        input: {
          tenantSlug: parsed.tenantSlug,
          images: parsed.images,
          customer_context: parsed.customer_context ?? {},
          render_opt_in: parsed.render_opt_in,
          createdAt: new Date().toISOString(),
        },
        output,
        renderOptIn: parsed.render_opt_in,
        renderStatus: parsed.render_opt_in ? "queued" : "not_requested",
      })
      .returning({ id: quoteLogs.id });

    return NextResponse.json({
      ok: true,
      quoteLogId: row.id,
      output,
      render_opt_in: parsed.render_opt_in,
    });
  } catch (err: any) {
    console.error("QUOTE_SUBMIT_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "REQUEST_FAILED", message: err.message },
      { status: 500 }
    );
  }
}
