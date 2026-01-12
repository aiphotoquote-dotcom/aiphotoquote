// src/app/api/tenant/me-settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";

import { db } from "../../../../lib/db/client";
import { tenants, tenantSettings } from "../../../../lib/db/schema";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    // ✅ Use db.select() so we don't depend on db.query typing
    const tenantRows = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        owner_clerk_user_id: tenants.owner_clerk_user_id,
      })
      .from(tenants)
      .where(eq(tenants.owner_clerk_user_id, userId))
      .limit(1);

    const tenant = tenantRows[0];

    if (!tenant?.id) {
      return NextResponse.json(
        { ok: false, error: "TENANT_NOT_FOUND" },
        { status: 404 }
      );
    }

    const url = new URL(req.url);
    const debug = url.searchParams.get("debug") === "1";

    if (debug) {
      const fingerprint = await db.execute(sql`
        select
          current_database() as db,
          current_schema() as schema
      `);

      const settingsCount = await db.execute(sql`
        select count(*)::int as ct
        from "tenant_settings"
        where "tenant_id" = ${tenant.id}::uuid
      `);

      const ct =
        (settingsCount.rows?.[0] as any)?.ct ??
        (settingsCount as any)?.[0]?.ct ??
        null;

      return NextResponse.json({
        ok: true,
        debug: {
          tenant_id: tenant.id,
          db: (fingerprint.rows?.[0] as any)?.db ?? null,
          schema: (fingerprint.rows?.[0] as any)?.schema ?? null,
          tenant_settings_rows_for_tenant: ct,
          postgres_url_tail: (process.env.POSTGRES_URL || "").slice(-12),
          vercel_env: process.env.VERCEL_ENV || null,
        },
      });
    }

    const settingsRows = await db
      .select({
        id: tenantSettings.id,
        tenant_id: tenantSettings.tenant_id,
        industry_key: tenantSettings.industry_key,
        redirect_url: tenantSettings.redirect_url,
        thank_you_url: tenantSettings.thank_you_url,
        created_at: tenantSettings.created_at,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenant_id, tenant.id))
      .limit(1);

    const settings = settingsRows[0] ?? null;

    return NextResponse.json({
      ok: true,
      tenant,
      settings,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL",
          message: err?.message || String(err),
        },
      },
      { status: 500 }
    );
  }
}
