import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import OpenAI from "openai";

import { db } from "@/lib/db/client";
import { tenants, tenantSecrets, tenantSettings, quoteLogs } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";

const CustomerContext = z
  .object({
    // ✅ new fields from QuoteForm
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    phone: z.string().min(7).optional(), // we store digits client-side; keep loose

    // existing fields
    notes: z.string().optional(),
    service_type: z.string().optional(),
    category: z.string().optional(),
  })
  .optional();

const Req = z.object({
  tenantSlug: z.string().min(3),
  images: z.array(z.object({ url: z.string().url() })).min(1).max(12),
  customer_context: CustomerContext,
});

const QuoteOutputSchema = z.object({
  confidence: z.enum(["high", "medium", "low"]),
  inspection_required: z.boolean(),
  summary: z.string(),
  visible_scope: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  questions: z.array(z.string()).default([]),
  estimate: z.object({
    currency: z.string().default("USD"),
    low: z.number().nonnegative(),
    high: z.number().nonnegative(),
  }),
  next_steps: z.array(z.string()).default([]),
});

function industryPrompt(industryKey: string) {
  switch (industryKey) {
    case "upholstery":
      return `You are a professional upholstery estimator (auto/marine/furniture).
Focus on what is visible: damage type, panel complexity, seams, foam collapse likelihood, material clues.
Be conservative and risk-aware. If you cannot see enough, require inspection.`;
    case "pressure_washing":
      return `You are a professional pressure washing estimator.
Focus on surface type, staining severity, access, likely square footage ranges, and risk factors.
Be conservative. Require inspection when uncertain.`;
    default:
      return `You are a professional estimator for the selected service industry.
Be conservative and risk-aware. Require inspection when uncertain.`;
  }
}

const SYSTEM = `You produce conservative photo-based estimates for service businesses.

Rules:
- Return ONLY valid JSON. No markdown. No extra text.
- This is an estimate range, not a final price.
- If images are insufficient, set inspection_required=true and confidence=low.
- Include assumptions + questions when uncertain.`;

function formatInstruction() {
  return `Return ONLY valid JSON with this structure:
{
  "confidence": "high|medium|low",
  "inspection_required": true|false,
  "summary": "string",
  "visible_scope": ["string", ...],
  "assumptions": ["string", ...],
  "questions": ["string", ...],
  "estimate": { "currency": "USD", "low": number, "high": number },
  "next_steps": ["string", ...]
}`;
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = Req.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION",
          message: "Invalid request",
          details: parsed.error.flatten(),
        },
      },
      { status: 400 }
    );
  }

  const { tenantSlug, images, customer_context } = parsed.data;

  const t = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug));
  const tenant = t[0];
  if (!tenant) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Tenant not found" } },
      { status: 404 }
    );
  }

  const settings = await db
    .select()
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenant.id));
  const s = settings[0];
  if (!s) {
    return NextResponse.json(
      { ok: false, error: { code: "CONFIG", message: "Tenant not onboarded yet" } },
      { status: 400 }
    );
  }

  const secrets = await db
    .select()
    .from(tenantSecrets)
    .where(eq(tenantSecrets.tenantId, tenant.id));
  const sec = secrets[0];
  if (!sec?.openaiKeyEnc) {
    return NextResponse.json(
      { ok: false, error: { code: "CONFIG", message: "Tenant OpenAI key not configured" } },
      { status: 400 }
    );
  }

  const openaiKey = decryptSecret(sec.openaiKeyEnc);
  const client = new OpenAI({ apiKey: openaiKey });

  const userContent: any[] = [
    {
      type: "text",
      text:
        `Customer context:\n${JSON.stringify(customer_context ?? {}, null, 2)}\n\n` +
        `Analyze the images and produce an estimate.\n\n` +
        formatInstruction(),
    },
    ...images.map((img) => ({
      type: "image_url",
      image_url: { url: img.url },
    })),
  ];

  // Vision-capable model (adjust later)
  const model = "gpt-4o-mini";

  try {
    const resp = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "system", content: industryPrompt(s.industryKey) },
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
    });

    const text = resp.choices[0]?.message?.content ?? "";

    let raw: any;
    try {
      raw = JSON.parse(text);
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "MODEL_BAD_JSON", message: "Model did not return valid JSON", details: text },
        },
        { status: 500 }
      );
    }

    const output = QuoteOutputSchema.parse(raw);

    await db.insert(quoteLogs).values({
      tenantId: tenant.id,
      input: { tenantSlug, images, customer_context, industryKey: s.industryKey },
      output,
      createdAt: new Date(),
    });

    return NextResponse.json({
      ok: true,
      output,
      redirectUrl: s.redirectUrl ?? null,
      thankYouUrl: s.thankYouUrl ?? null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: { code: "MODEL_ERROR", message: e?.message ?? "Model call failed" } },
      { status: 500 }
    );
  }
}
