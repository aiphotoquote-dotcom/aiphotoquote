// app/api/tenant/me-settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";

// ⬇️ Adjust these two imports ONLY if your project uses different paths.
// (No other hunting. If your build errors, it will tell you the exact path.)
import { db } from "@/lib/db";
import { tenants, tenant_settings } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    // Find tenant for this user
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.owner_clerk_user_id, userId),
      columns: { id: true, name: true, slug: true, owner_clerk_user_id: true },
    });

    if (!tenant?.id) {
      return NextResponse.json(
        { ok: false, error: "TENANT_NOT_FOUND" },
        { status: 404 }
      );
    }

    const url = new URL(req.url);
    const debug = url.searchParams.get("debug") === "1";

    if (debug) {
      // DB fingerprint + confirm the settings row exists in *this* DB/environment
      const fingerprint = await db.execute(sql`
        select
          current_database() as db,
          current_schema() as schema
      `);

      const settingsCount = await db.execute(sql`
        select count(*)::int as ct
        from tenant_settings
        where tenant_id = ${tenant.id}::uuid
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

    // Normal read
    const settings = await db.query.tenant_settings.findFirst({
      where: eq(tenant_settings.tenant_id, tenant.id),
      columns: {
        id: true,
        tenant_id: true,
        industry_key: true,
        redirect_url: true,
        thank_you_url: true,
        created_at: true,
      },
    });

    return NextResponse.json({
      ok: true,
      tenant,
      settings: settings ?? null,
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
