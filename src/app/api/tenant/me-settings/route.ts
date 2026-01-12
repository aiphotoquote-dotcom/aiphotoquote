import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  tenants,
  tenantSecrets,
  tenantSettings,
  tenantPricingRules,
} from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHENTICATED", message: "Not signed in" } },
      { status: 401 }
    );
  }

  // Assumption: tenants has ownerUserId (Clerk userId)
  const t = await db.select().from(tenants).where(eq(tenants.ownerUserId, userId));
  const tenant = t[0];

  if (!tenant) {
    return NextResponse.json({ ok: true, exists: false });
  }

  const s = (await db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenant.id)))[0];
  const p = (await db.select().from(tenantPricingRules).where(eq(tenantPricingRules.tenantId, tenant.id)))[0];
  const sec = (await db.select().from(tenantSecrets).where(eq(tenantSecrets.tenantId, tenant.id)))[0];

  return NextResponse.json({
    ok: true,
    exists: true,
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
    },
    settings: s
      ? {
          industryKey: s.industryKey,
          redirectUrl: s.redirectUrl ?? "",
          thankYouUrl: s.thankYouUrl ?? "",
        }
      : null,
    pricing: p
      ? {
          minJob: p.minJob ?? null,
          typicalLow: p.typicalLow ?? null,
          typicalHigh: p.typicalHigh ?? null,
          maxWithoutInspection: p.maxWithoutInspection ?? null,
        }
      : null,
    // We never return raw keys. This is just for UI display.
    secrets: sec?.openaiKeyEnc
      ? { hasOpenAIKey: true }
      : { hasOpenAIKey: false },
  });
}
