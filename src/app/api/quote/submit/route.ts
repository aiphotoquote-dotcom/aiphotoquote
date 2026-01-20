// src/app/api/quote/submit/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import OpenAI from "openai";

import { db } from "@/lib/db/client";
import { tenants, tenantSecrets, tenantSettings, quoteLogs } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";

const CustomerSchema = z.object({
  name: z.string().min(2, "Name is required"),
  phone: z.string().min(7, "Phone is required"),
  email: z.string().email("Valid email is required"),
});

// Back-compat:
// - QuoteForm currently sends: contact {name,email,phone}
// - We now prefer: customer {name,email,phone}
const Req = z.object({
  tenantSlug: z.string().min(3),
  images: z
    .array(z.object({ url: z.string().url(), shotType: z.string().optional() }))
    .min(1)
    .max(12),

  // ✅ NEW preferred shape
  customer: CustomerSchema.optional(),

  // ✅ Back-compat shape
  contact: CustomerSchema.optional(),

  // existing
  render_opt_in: z.boolean().optional(),
  customer_context: z
    .object({
      notes: z.string().optional(),
      service_type: z.string().optional(),
      category: z.string().optional(),
    })
    .optional(),
});

function normalizePhone(raw: string) {
  return String(raw ?? "").replace(/\D/g, "");
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = Req.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "INVALID_BODY", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { tenantSlug, images } = parsed.data;

    // Accept customer OR contact (but require one of them)
    const incoming = parsed.data.customer ?? parsed.data.contact;
    if (!incoming) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_CUSTOMER",
          message: "Customer info is required (name, phone, email).",
        },
        { status: 400 }
      );
    }

    const customer = {
      name: incoming.name.trim(),
      phone: normalizePhone(incoming.phone),
      email: incoming.email.trim().toLowerCase(),
    };

    if (customer.phone.length < 10) {
      return NextResponse.json(
        { ok: false, error: "INVALID_PHONE", message: "Phone must include at least 10 digits." },
        { status: 400 }
      );
    }

    // Tenant lookup
    const tenant = await db
      .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.slug, tenantSlug))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!tenant) {
      return NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND" }, { status: 404 });
    }

    // Settings (optional)
    await db
      .select({
        tenantId: tenantSettings.tenantId,
        industryKey: tenantSettings.industryKey,
        aiRenderingEnabled: tenantSettings.aiRenderingEnabled,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenant.id))
      .limit(1)
      .then((r) => r[0] ?? null);

    // Decrypt OpenAI key
    const secretRow = await db
      .select({ openaiKeyEnc: tenantSecrets.openaiKeyEnc })
      .from(tenantSecrets)
      .where(eq(tenantSecrets.tenantId, tenant.id))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!secretRow?.openaiKeyEnc) {
      return NextResponse.json({ ok: false, error: "MISSING_OPENAI_KEY" }, { status: 400 });
    }

    const openaiKey = decryptSecret(secretRow.openaiKeyEnc);
    const openai = new OpenAI({ apiKey: openaiKey });

    const renderOptIn = Boolean(parsed.data.render_opt_in);

    const customer_context = parsed.data.customer_context ?? {};
    const category = customer_context.category ?? "service";
    const service_type = customer_context.service_type ?? "upholstery";
    const notes = customer_context.notes ?? "";

    // --- Build input we store (consistent, includes customer) ---
    const inputToStore = {
      tenantSlug,
      images,
      render_opt_in: renderOptIn,

      // ✅ Normalize into a single place so admin always knows where to look
      customer,

      customer_context: {
        category,
        service_type,
        notes,
      },
      createdAt: new Date().toISOString(),
    };

    const prompt = `
You are generating a quick price estimate range for a ${category} job.
Service type: ${service_type}
Customer notes: ${notes || "(none)"}
Return JSON with: estimateLow, estimateHigh, inspectionRequired (boolean), summary.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Return ONLY valid JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
    });

    const raw = completion.choices?.[0]?.message?.content ?? "{}";
    let output: any = {};
    try {
      output = JSON.parse(raw);
    } catch {
      output = { raw };
    }

    // Save quote log
    const inserted = await db
      .insert(quoteLogs)
      .values({
        tenantId: tenant.id,
        input: inputToStore,
        output,
        renderOptIn,
      })
      .returning({ id: quoteLogs.id })
      .then((r) => r[0] ?? null);

    return NextResponse.json({
      ok: true,
      quoteLogId: inserted?.id ?? null,
      output,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}