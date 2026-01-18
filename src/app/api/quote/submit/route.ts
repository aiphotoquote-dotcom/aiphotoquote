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
  customer_context: z.object({
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    notes: z.string().optional(),
  }),
  render_opt_in: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = Req.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "BAD_REQUEST", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { tenantSlug, images, customer_context, render_opt_in } = parsed.data;

    /* -------------------------------------------------
     * 1. Resolve tenant
     * ------------------------------------------------- */
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.slug, tenantSlug),
    });

    if (!tenant) {
      return NextResponse.json(
        { ok: false, error: "TENANT_NOT_FOUND" },
        { status: 404 }
      );
    }

    /* -------------------------------------------------
     * 2. Load tenant OpenAI key (NOT platform key)
     * ------------------------------------------------- */
    const secret = await db.query.tenantSecrets.findFirst({
      where: eq(tenantSecrets.tenantId, tenant.id),
    });

    if (!secret) {
      return NextResponse.json(
        {
          ok: false,
          error: "TENANT_OPENAI_KEY_MISSING",
          message:
            "Tenant has not configured an OpenAI API key yet.",
        },
        { status: 400 }
      );
    }

    const openaiKey = decryptSecret(secret.openaiKeyEnc);
    const openai = new OpenAI({ apiKey: openaiKey });

    /* -------------------------------------------------
     * 3. Build AI prompt
     * ------------------------------------------------- */
    const prompt = `
You are an expert upholstery estimator.

Analyze the provided images and notes.
Return a JSON object with:
- confidence ("high" | "medium" | "low")
- inspection_required (boolean)
- summary (string)
- questions (array of strings)
- estimate { low: number, high: number }

Be conservative and professional.
`;

    const visionInput = images.map((img) => ({
      type: "image_url",
      image_url: { url: img.url },
    }));

    /* -------------------------------------------------
     * 4. Call OpenAI
     * ------------------------------------------------- */
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...visionInput,
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    const aiOutput = JSON.parse(
      completion.choices[0].message.content || "{}"
    );

    /* -------------------------------------------------
     * 5. Persist quote (JSON-only schema)
     * ------------------------------------------------- */
    const [row] = await db
      .insert(quoteLogs)
      .values({
        tenantId: tenant.id,
        input: {
          images,
          customer_context,
        },
        output: aiOutput,
        renderOptIn: Boolean(render_opt_in),
        renderStatus: render_opt_in ? "queued" : "not_requested",
      })
      .returning({ id: quoteLogs.id });

    /* -------------------------------------------------
     * 6. Return response
     * ------------------------------------------------- */
    return NextResponse.json({
      ok: true,
      quoteLogId: row.id,
      output: aiOutput,
      render_opt_in: Boolean(render_opt_in),
    });
  } catch (err: any) {
    console.error("QUOTE_SUBMIT_ERROR", err);

    return NextResponse.json(
      {
        ok: false,
        error: "REQUEST_FAILED",
        message: err?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}
