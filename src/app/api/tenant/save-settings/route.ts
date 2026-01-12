import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { tenants, tenantSecrets, tenantSettings, tenantPricingRules } from "@/lib/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { eq } from "drizzle-orm";

const Req = z.object({
  tenant: z.object({
    name: z.string().min(2).max(120),
    slug: z.string().min(3).max(40).regex(/^[a-z0-9-]+$/),
  }),
  industryKey: z.string().min(2).max(60),
  openaiKey: z.string().min(10).optional(), // optional if saving other settings
  redirects: z.object({
    redirectUrl: z.string().url().optional(),
    thankYouUrl: z.string().url().optional(),
  }).optional(),
  pricing: z.object({
    minJob: z.number().nonnegative().optional(),
    typicalLow: z.number().nonnegative().optional(),
    typicalHigh: z.number().nonnegative().optional(),
    maxWithoutInspection: z.number().nonnegative().optional(),
    serviceFee: z.number().nonnegative().optional(),
    tone: z.enum(["value", "premium", "budget"]).optional(),
    riskPosture: z.enum(["conservative", "balanced", "aggressive"]).optional(),
    alwaysEstimateLanguage: z.boolean().optional(),
  }).optional(),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: { code: "UNAUTH", message: "Not signed in" } }, { status: 401 });

  const body = await req.json();
  const parsed = Req.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: { code: "VALIDATION", message: "Invalid request", details: parsed.error.flatten() } }, { status: 400 });
  }

  const { tenant, industryKey, openaiKey, redirects, pricing } = parsed.data;

  // Upsert tenant by slug
  const existing = await db.select().from(tenants).where(eq(tenants.slug, tenant.slug));
  let tenantId = existing[0]?.id;

  if (!tenantId) {
    const inserted = await db.insert(tenants).values({ name: tenant.name, slug: tenant.slug }).returning({ id: tenants.id });
    tenantId = inserted[0].id;
  } else {
    await db.update(tenants).set({ name: tenant.name }).where(eq(tenants.id, tenantId));
  }

  // Upsert settings
  const hasSettings = await db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId));
  if (!hasSettings[0]) {
    await db.insert(tenantSettings).values({
      tenantId,
      industryKey,
      redirectUrl: redirects?.redirectUrl,
      thankYouUrl: redirects?.thankYouUrl,
    });
  } else {
    await db.update(tenantSettings).set({
      industryKey,
      redirectUrl: redirects?.redirectUrl,
      thankYouUrl: redirects?.thankYouUrl,
      updatedAt: new Date(),
    }).where(eq(tenantSettings.tenantId, tenantId));
  }

  // Upsert pricing rules
  if (pricing) {
    const hasPricing = await db.select().from(tenantPricingRules).where(eq(tenantPricingRules.tenantId, tenantId));
    const row = {
      tenantId,
      minJob: pricing.minJob?.toString(),
      typicalLow: pricing.typicalLow?.toString(),
      typicalHigh: pricing.typicalHigh?.toString(),
      maxWithoutInspection: pricing.maxWithoutInspection?.toString(),
      serviceFee: pricing.serviceFee?.toString(),
      tone: pricing.tone ?? "value",
      riskPosture: pricing.riskPosture ?? "conservative",
      alwaysEstimateLanguage: pricing.alwaysEstimateLanguage ?? true,
      updatedAt: new Date(),
    };

    if (!hasPricing[0]) await db.insert(tenantPricingRules).values(row);
    else await db.update(tenantPricingRules).set(row).where(eq(tenantPricingRules.tenantId, tenantId));
  }

  // Save OpenAI key (encrypted)
  if (openaiKey) {
    const enc = encryptSecret(openaiKey);
    const last4 = openaiKey.slice(-4);

    const hasSecret = await db.select().from(tenantSecrets).where(eq(tenantSecrets.tenantId, tenantId));
    if (!hasSecret[0]) {
      await db.insert(tenantSecrets).values({ tenantId, openaiKeyEnc: enc, openaiKeyLast4: last4, updatedAt: new Date() });
    } else {
      await db.update(tenantSecrets).set({ openaiKeyEnc: enc, openaiKeyLast4: last4, updatedAt: new Date() }).where(eq(tenantSecrets.tenantId, tenantId));
    }
  }

  return NextResponse.json({ ok: true, tenantId });
}
