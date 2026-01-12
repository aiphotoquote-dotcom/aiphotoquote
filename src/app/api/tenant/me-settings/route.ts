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
export const dynamic = "force-dynamic";

function j(ok: boolean, payload: any, status = 200) {
  return NextResponse.json({ ok, ...payload }, { status });
}

async function tableExists(tableName: string) {
  // @ts-ignore
  const r: any = await db.execute(
    `select exists (
       select 1 from information_schema.tables
       where table_schema = 'public' and table_name = '${tableName}'
     ) as ok`
  );
  const v =
    (Array.isArray(r) ? r[0]?.ok : r?.rows?.[0]?.ok) ??
    (Array.isArray(r) ? r[0]?.exists : r?.rows?.[0]?.exists);
  return !!v;
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId)
      return j(
        false,
        { error: { code: "UNAUTHENTICATED", message: "Not signed in" } },
        401
      );

    // Check required tables exist in THIS DB (Vercel-connected)
    const needed = [
      "tenants",
      "tenant_settings",
      "tenant_pricing_rules",
      "tenant_secrets",
    ];

    const missing: string[] = [];
    for (const t of needed) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await tableExists(t);
      if (!ok) missing.push(t);
    }

    if (missing.length) {
      return j(
        false,
        {
          error: {
            code: "DB_SCHEMA_MISSING",
            message:
              "Missing tables in the connected database. Run migrations against the same DB Vercel uses.",
            details: { missing },
          },
        },
        500
      );
    }

    // Find tenant for this user
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
    return j(
      false,
      { error: { code: "INTERNAL", message: e?.message ?? String(e) } },
      500
    );
  }
}
