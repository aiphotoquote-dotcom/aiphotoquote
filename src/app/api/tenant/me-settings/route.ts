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

export const runtime = "nodejs";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHENTICATED", message: "Not signed in" } },
      { status: 401 }
    );
  }

  // Tenant is owned by the signed-in Clerk user
  const t = await db
    .select()
    .from(tenants)
    .where(eq(tenants.ownerClerkUserId, userId));

  const tenant = t[0];

  if (!tenant) {
    return NextResponse.json({ ok: true, exists: false });
  }

  const s =
    (
      await db
        .select()
        .from(tenantSettings)
        .where(eq(tenantSettings.tenantId, tenant.id))
    )[0] ?? null;

  const p =
    (
      await db
        .select()
        .from(tenantPricingRules)
        .where(eq(tenantPricingRules.tenantId, tenant.id))
    )[0] ?? null;

  const sec =
    (
      await db
        .select()
        .from(tenantSecrets)
        .where(eq(tenantSecrets.tenantId, tenant.id))
    )[0] ?? null;

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
    secrets: { hasOpenAIKey: !!sec?.openaiKeyEnc },
  });
}
