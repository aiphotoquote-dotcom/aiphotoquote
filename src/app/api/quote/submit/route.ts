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
  name: z.string().min(2),
  phone: z
    .string()
    .min(10)
    .transform((v) => v.replace(/\D/g, "")) // store digits-only
    .refine((v) => v.length >= 10, "Phone must have at least 10 digits"),
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
});

const Req = z.object({
  tenantSlug: z.string().min(3),
  images: z.array(z.object({ url: z.string().url(), shotType: z.string().optional() })).min(1).max(12),

  // ✅ NEW required customer identity
  customer: CustomerSchema,

  customer_context: z
    .object({
      notes: z.string().optional(),
      service_type: z.string().optional(),
      category: z.string().optional(),
    })
    .optional(),

  // keep compatibility with your existing payloads
  render_opt_in: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    const json = await req.json().catch(() => null);
    const parsed = Req.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "INVALID_BODY", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { tenantSlug, images, customer, customer_context } = parsed.data;
    const renderOptIn = Boolean((parsed.data as any).render_opt_in);

    // Resolve tenant
    const tenant = await db
      .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.slug, tenantSlug))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!tenant) {
      return NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND" }, { status: 404 });
    }

    // Load OpenAI key from tenantSecrets
    const secret = await db
      .select({ openaiKeyEnc: tenantSecrets.openaiKeyEnc })
      .from(tenantSecrets)
      .where(eq(tenantSecrets.tenantId, tenant.id))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!secret?.openaiKeyEnc) {
      return NextResponse.json({ ok: false, error: "TENANT_OPENAI_KEY_MISSING" }, { status: 400 });
    }

    const openaiKey = decryptSecret(secret.openaiKeyEnc);
    const openai = new OpenAI({ apiKey: openaiKey });

    // Optional: tenant settings used by your estimator
    const settings = await db
      .select({
        industryKey: tenantSettings.industryKey,
        aiMode: tenantSettings.aiMode,
        pricingEnabled: tenantSettings.pricingEnabled,
        aiRenderingEnabled: tenantSettings.aiRenderingEnabled,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenant.id))
      .limit(1)
      .then((r) => r[0] ?? null);

    // ---- Build the input payload we persist ----
    const input = {
      tenantSlug,
      createdAt: new Date().toISOString(),
      images,
      render_opt_in: renderOptIn,
      customer, // ✅ persisted here for admin UI + emails
      customer_context: customer_context ?? {},
    };

    // ---- Call your model / pricing logic (placeholder) ----
    // If your existing implementation is more complex, paste it here and I’ll integrate cleanly.
    const output = {
      confidence: "medium",
      inspection_required: false,
      summary: "Estimate generated.",
      visible_scope: [],
      assumptions: [],
      questions: [],
    };

    // Persist quote log
    const inserted = await db
      .insert(quoteLogs)
      .values({
        tenantId: tenant.id,
        input,
        output,
        renderOptIn,
        // stage/isRead defaults handled by DB defaults
      })
      .returning({ id: quoteLogs.id });

    const quoteId = inserted?.[0]?.id;

    return NextResponse.json({ ok: true, quoteId });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
