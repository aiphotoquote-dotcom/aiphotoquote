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
  tenantSlug: z.string().min(3),
  images: z.array(
    z.object({
      url: z.string().url(),
      shotType: z.string().optional(),
    })
  ),
  customer_context: z.any().optional(),
  contact: z.any().optional(),
  render_opt_in: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = Req.parse(body);

    const { tenantSlug, images, customer_context, contact, render_opt_in } =
      parsed;

    // ---- tenant lookup ----
    const tenant = await db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, tenantSlug))
      .limit(1)
      .then((r) => r[0]);

    if (!tenant) {
      return NextResponse.json(
        { ok: false, error: "TENANT_NOT_FOUND" },
        { status: 404 }
      );
    }

    // ---- tenant OpenAI key (tenant-only model) ----
    const secret = await db
      .select()
      .from(tenantSecrets)
      .where(eq(tenantSecrets.tenantId, tenant.id))
      .limit(1)
      .then((r) => r[0]);

    if (!secret?.openaiKeyEnc) {
      return NextResponse.json(
        {
          ok: false,
          error: "TENANT_OPENAI_KEY_MISSING",
        },
        { status: 400 }
      );
    }

    const apiKey = decryptSecret(secret.openaiKeyEnc);
    const openai = new OpenAI({ apiKey });

    // ---- create initial quote log (VALID COLUMNS ONLY) ----
    const input = {
      images,
      customer_context,
      contact,
      render_opt_in,
      createdAt: new Date().toISOString(),
    };

    const [{ id: quoteLogId }] = await db
      .insert(quoteLogs)
      .values({
        tenantId: tenant.id,
        input,
        output: {},
        renderOptIn: render_opt_in,
        renderStatus: render_opt_in ? "queued" : "not_requested",
      })
      .returning({ id: quoteLogs.id });

    // ---- OpenAI call ----
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" as any },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Provide a repair estimate in JSON only.",
            },
            ...images.map((img) => ({
              type: "image_url",
              image_url: { url: img.url },
            })),
          ] as any,
        },
      ],
    });

    const raw = completion.choices[0].message.content ?? "{}";
    const output = JSON.parse(raw);

    // ---- update quote log (JSON ONLY) ----
    await db
      .update(quoteLogs)
      .set({
        output,
      })
      .where(eq(quoteLogs.id, quoteLogId));

    return NextResponse.json({
      ok: true,
      quoteLogId,
      output,
      render_opt_in,
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { ok: false, error: "REQUEST_FAILED", message: err.message },
      { status: 500 }
    );
  }
}
