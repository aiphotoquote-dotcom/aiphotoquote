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
// Helpful while debugging API routes on Vercel
export const dynamic = "force-dynamic";

function j(ok: boolean, payload: any, status = 200) {
  return NextResponse.json({ ok, ...payload }, { status });
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return j(false, { error: { code: "UNAUTHENTICATED", message: "Not signed in" } }, 401);

    // Quick sanity: confirm the app has a DB url at runtime in Vercel
    const hasDbUrl = !!(process.env.POSTGRES_URL || process.env.DATABASE_URL);
    if (!hasDbUrl) {
      return j(false, {
        error: {
          code: "CONFIG_ERROR",
          message:
            "Missing POSTGRES_URL (or DATABASE_URL) in Vercel environment variables.",
        },
      }, 500);
    }

    // Validate the column exists in THIS database (helps detect DB mismatch)
    // @ts-ignore - drizzle execute typing varies by driver
    const colCheck: any = await db.execute(`
      select exists(
        select 1
        from information_schema.columns
        where table_name='tenants'
          and column_name='owner_clerk_user_id'
      ) as has_owner_col
    `);

    const hasOwnerCol =
      (Array.isArray(colCheck) ? colCheck[0]?.has_owner_col : colCheck?.rows?.[0]?.has_owner_col) ??
      false;

    if (!hasOwnerCol) {
      return j(false, {
        error: {
          code: "DB_SCHEMA_MISMATCH",
          message:
            "This database does not have tenants.owner_clerk_user_id. You likely updated a different DB than the one Vercel is using.",
        },
      }, 500);
    }

    // Tenant is owned by signed-in Clerk user
    const t = await db
      .select()
      .from(tenants)
      .where(eq(tenants.ownerClerkUserId, userId));

    const tenant = t[0];
    if (!tenant) return j(true, { exists: false });

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

    return j(true, {
      exists: true,
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
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
  } catch (e: any) {
    // Return the actual error so you can see it in the browser
    return j(false, {
      error: {
        code: "INTERNAL",
        message: e?.message ?? String(e),
      },
    }, 500);
  }
}
