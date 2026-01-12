import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  tenants,
  tenantSettings,
  tenantPricingRules,
  tenantSecrets,
} from "@/lib/db/schema";
import { encryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";

// ---- validation ----
const BodySchema = z.object({
  tenant: z.object({
    name: z.string().min(2),
    slug: z.string().min(2),
  }),
  industryKey: z.string().min(1),

  // Only sent if user typed a new key (we never return stored key)
  openaiKey: z.string().min(10).optional(),

  redirects: z
    .object({
      redirectUrl: z.string().optional(),
      thankYouUrl: z.string().optional(),
    })
    .optional(),

  pricing: z
    .object({
      minJob: z.number().int().positive().optional(),
      typicalLow: z.number().int().positive().optional(),
      typicalHigh: z.number().int().positive().optional(),
      maxWithoutInspection: z.number().int().positive().optional(),

      tone: z.string().optional(),
      riskPosture: z.string().optional(),
      alwaysEstimateLanguage: z.boolean().optional(),
    })
    .optional(),
});

function err(code: string, message: string, details?: any, status = 400) {
  return NextResponse.json(
    { ok: false, error: { code, message, details } },
    { status }
  );
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return err("UNAUTHENTICATED", "Not signed in", null, 401);

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e: any) {
    return err("BAD_REQUEST", "Invalid request body", e?.issues ?? String(e));
  }

  const { tenant, industryKey, openaiKey, redirects, pricing } = body;

  // 1) Load tenant for this user (or create)
  const existing = await db
    .select()
    .from(tenants)
    .where(eq(tenants.ownerClerkUserId, userId));

  const found = existing[0];
  let tenantId = found?.id;

  if (!tenantId) {
    // Create tenant
    try {
      const inserted = await db
        .insert(tenants)
        .values({
          name: tenant.name,
          slug: tenant.slug,
          ownerClerkUserId: userId,
        })
        .returning({ id: tenants.id });

      tenantId = inserted[0]?.id;
      if (!tenantId) return err("DB_ERROR", "Failed to create tenant");
    } catch (e: any) {
      // Slug uniqueness conflict, etc.
      return err("DB_ERROR", "Failed to create tenant", e?.message ?? String(e));
    }
  } else {
    // Update tenant name/slug
    try {
      await db
        .update(tenants)
        .set({
          name: tenant.name,
          slug: tenant.slug,
        })
        .where(eq(tenants.id, tenantId));
    } catch (e: any) {
      return err("DB_ERROR", "Failed to update tenant", e?.message ?? String(e));
    }
  }

  // 2) Upsert tenant_settings
  const existingSettings = await db
    .select({ id: tenantSettings.id })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId));

  const settingsRow = {
    tenantId,
    industryKey,
    redirectUrl: redirects?.redirectUrl ?? null,
    thankYouUrl: redirects?.thankYouUrl ?? null,
  };

  try {
    if (existingSettings[0]?.id) {
      await db
        .update(tenantSettings)
        .set({
          industryKey: settingsRow.industryKey,
          redirectUrl: settingsRow.redirectUrl,
          thankYouUrl: settingsRow.thankYouUrl,
        })
        .where(eq(tenantSettings.tenantId, tenantId));
    } else {
      await db.insert(tenantSettings).values(settingsRow);
    }
  } catch (e: any) {
    return err(
      "DB_ERROR",
      "Failed to save tenant settings",
      e?.message ?? String(e)
    );
  }

  // 3) Upsert pricing rules (optional)
  if (pricing) {
    const existingPricing = await db
      .select({ id: tenantPricingRules.id })
      .from(tenantPricingRules)
      .where(eq(tenantPricingRules.tenantId, tenantId));

    const pricingRow = {
      tenantId,
      minJob: pricing.minJob ?? null,
      typicalLow: pricing.typicalLow ?? null,
      typicalHigh: pricing.typicalHigh ?? null,
      maxWithoutInspection: pricing.maxWithoutInspection ?? null,
      tone: pricing.tone ?? "value",
      riskPosture: pricing.riskPosture ?? "conservative",
      alwaysEstimateLanguage:
        pricing.alwaysEstimateLanguage ?? true,
    };

    try {
      if (existingPricing[0]?.id) {
        await db
          .update(tenantPricingRules)
          .set(pricingRow)
          .where(eq(tenantPricingRules.tenantId, tenantId));
      } else {
        await db.insert(tenantPricingRules).values(pricingRow);
      }
    } catch (e: any) {
      return err(
        "DB_ERROR",
        "Failed to save pricing rules",
        e?.message ?? String(e)
      );
    }
  }

  // 4) Save OpenAI key (optional; only if user provided it)
  if (openaiKey && openaiKey.trim().length > 0) {
    let openaiKeyEnc: string;
    try {
      openaiKeyEnc = encryptSecret(openaiKey.trim());
    } catch (e: any) {
      return err(
        "CONFIG_ERROR",
        "Failed to encrypt OpenAI key. Check ENCRYPTION_KEY.",
        e?.message ?? String(e)
      );
    }

    const existingSecret = await db
      .select({ id: tenantSecrets.id })
      .from(tenantSecrets)
      .where(eq(tenantSecrets.tenantId, tenantId));

    try {
      if (existingSecret[0]?.id) {
        await db
          .update(tenantSecrets)
          .set({ openaiKeyEnc })
          .where(eq(tenantSecrets.tenantId, tenantId));
      } else {
        await db.insert(tenantSecrets).values({
          tenantId,
          openaiKeyEnc,
        });
      }
    } catch (e: any) {
      return err(
        "DB_ERROR",
        "Failed to save OpenAI key",
        e?.message ?? String(e)
      );
    }
  }

  return NextResponse.json({ ok: true, tenantId });
}
