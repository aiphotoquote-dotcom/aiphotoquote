import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import OpenAI from "openai";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// -----------------------------
// Request schema (IMPORTANT)
// -----------------------------
const Req = z.object({
  tenantSlug: z.string().min(3),
  images: z.array(z.object({ url: z.string().url(), shotType: z.string().optional() })).min(1).max(12),
  customer_context: z
    .object({
      notes: z.string().optional(),
      service_type: z.string().optional(),
      category: z.string().optional(),

      // ✅ this was getting stripped before; now it persists into quote_logs.input
      render_opt_in: z.boolean().optional(),
    })
    .optional(),
  contact: z
    .object({
      name: z.string().min(1),
      email: z.string().min(3),
      phone: z.string().min(7),
    })
    .optional(),
});

// -----------------------------
// Output schema (what UI shows)
// -----------------------------
const QuoteOutputSchema = z.object({
  confidence: z.enum(["high", "medium", "low"]),
  inspection_required: z.boolean(),
  summary: z.string(),
  questions: z.array(z.string()).default([]),
  estimate: z.object({
    low: z.number(),
    high: z.number(),
  }),
  // ✅ we always include this so UI and render step stay consistent
  render_opt_in: z.boolean().default(false),
});

// -----------------------------
// Helpers
// -----------------------------
function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function safeJsonParse(v: any) {
  try {
    if (v == null) return null;
    if (typeof v === "object") return v;
    if (typeof v === "string") return JSON.parse(v);
    return v;
  } catch {
    return null;
  }
}

async function getTenantBySlug(slug: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  return rows[0] ?? null;
}

async function getTenantIndustryKey(tenantId: string): Promise<string | null> {
  try {
    const r = await db.execute(
      sql`select industry_key from tenant_settings where tenant_id = ${tenantId}::uuid limit 1`
    );
    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
    const v = row?.industry_key ?? null;
    return v ? String(v) : null;
  } catch {
    return null;
  }
}

async function getTenantOpenAiKey(tenantId: string): Promise<string | null> {
  const r = await db.execute(
    sql`select openai_key_enc from tenant_secrets where tenant_id = ${tenantId}::uuid limit 1`
  );
  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  const enc = row?.openai_key_enc ?? null;
  if (!enc) return null;
  return decryptSecret(enc);
}

function buildPrompt(args: {
  industryKey: string | null;
  category: string;
  serviceType: string;
  notes: string;
  imageUrls: string[];
  renderOptIn: boolean;
}) {
  const { industryKey, category, serviceType, notes, imageUrls, renderOptIn } = args;

  return [
    "You are an expert service estimator. Return ONLY JSON matching this schema:",
    JSON.stringify(
      {
        confidence: "high|medium|low",
        inspection_required: true,
        summary: "short customer-friendly summary",
        questions: ["list", "of", "questions"],
        estimate: { low: 0, high: 0 },
        render_opt_in: false,
      },
      null,
      2
    ),
    "",
    "Rules:",
    "- Keep summary customer-friendly and specific.",
    "- Ask clarifying questions that affect scope/cost.",
    "- estimate.low and estimate.high should be plausible for the described work.",
    "- Set render_opt_in EXACTLY to the provided customer opt-in.",
    "",
    `Industry: ${industryKey ?? "unknown"}`,
    `Category: ${category || "service"}`,
    `Service type: ${serviceType || "general"}`,
    `Customer notes: ${notes || "(none)"}`,
    `Customer render opt-in: ${renderOptIn ? "true" : "false"}`,
    "",
    "Photos (URLs):",
    ...imageUrls.map((u, i) => `${i + 1}. ${u}`),
  ].join("\n");
}

async function insertQuoteLog(args: { tenantId: string; input: any; output: any }) {
  // Uses raw SQL to avoid drift in Drizzle schema fields.
  const inputStr = JSON.stringify(args.input ?? {});
  const outputStr = JSON.stringify(args.output ?? {});

  const r = await db.execute(sql`
    insert into quote_logs (tenant_id, input, output)
    values (${args.tenantId}::uuid, ${inputStr}::jsonb, ${outputStr}::jsonb)
    returning id
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  const id = row?.id ? String(row.id) : null;
  return id;
}

// -----------------------------
// Route
// -----------------------------
export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => null);
    const parsed = Req.safeParse(raw);
    if (!parsed.success) {
      return json(
        { ok: false, error: "BAD_REQUEST_VALIDATION", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { tenantSlug, images, customer_context, contact } = parsed.data;

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return json({ ok: false, error: "TENANT_NOT_FOUND" }, { status: 404 });

    const tenantId = String((tenant as any).id);

    const openAiKey = await getTenantOpenAiKey(tenantId);
    if (!openAiKey) return json({ ok: false, error: "OPENAI_KEY_MISSING" }, { status: 500 });

    const industryKey = await getTenantIndustryKey(tenantId);

    const notes = (customer_context?.notes ?? "").toString().trim();
    const category = (customer_context?.category ?? "service").toString().trim();
    const serviceType = (customer_context?.service_type ?? "general").toString().trim();

    // ✅ THIS is the value that must persist end-to-end
    const renderOptIn = !!customer_context?.render_opt_in;

    const imageUrls = images.map((x) => x.url).filter(Boolean);

    const prompt = buildPrompt({
      industryKey,
      category,
      serviceType,
      notes,
      imageUrls,
      renderOptIn,
    });

    const openai = new OpenAI({ apiKey: openAiKey });

    // Use a cheap default model for text assessment
    const model = process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini";

    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.3,
      messages: [
        { role: "system", content: "Return only valid JSON. Do not wrap in markdown." },
        { role: "user", content: prompt },
      ],
    });

    const text = completion.choices?.[0]?.message?.content ?? "";
    const obj = safeJsonParse(text);

    // Validate/normalize output
    const normalized = QuoteOutputSchema.safeParse(obj);
    const output = normalized.success
      ? {
          ...normalized.data,
          // ✅ force it to match the customer choice no matter what the model did
          render_opt_in: renderOptIn,
        }
      : {
          confidence: "low" as const,
          inspection_required: true,
          summary:
            "We received your photos and notes. We’ll review and follow up with any clarifying questions needed.",
          questions: ["Can you confirm the scope and material preferences?"],
          estimate: { low: 0, high: 0 },
          render_opt_in: renderOptIn,
          _model_parse_error: true,
          _raw: text?.slice(0, 2000) ?? "",
        };

    // Persist full input (including render_opt_in)
    const input = {
      tenantSlug,
      images: images.map((x) => ({ url: x.url, shotType: x.shotType ?? undefined })),
      customer_context: {
        notes: notes || undefined,
        category: category || undefined,
        service_type: serviceType || undefined,
        render_opt_in: renderOptIn,
      },
      contact: contact
        ? {
            name: contact.name,
            email: contact.email,
            phone: contact.phone,
          }
        : undefined,
    };

    const quoteLogId = await insertQuoteLog({ tenantId, input, output });

    return json(
      {
        ok: true,
        quoteLogId,
        output,
      },
      { status: 200 }
    );
  } catch (err: any) {
    return json(
      {
        ok: false,
        error: "INTERNAL",
        message: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}
