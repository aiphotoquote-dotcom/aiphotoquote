import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants, tenantSettings } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return json({ ok: false, error: "UNAUTHENTICATED" }, 401);

    // Next 16: cookies() is async
    const jar = await cookies();

    const candidates = [
      jar.get("activeTenantId")?.value,
      jar.get("active_tenant_id")?.value,
      jar.get("tenantId")?.value,
      jar.get("tenant_id")?.value,
    ].filter(Boolean) as string[];

    let tenant: any = null;

    // 1) Prefer active-tenant cookie if present
    if (candidates.length) {
      const tenantId = candidates[0];

      const rows = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, tenantId as any))
        .limit(1);

      if (rows[0] && String(rows[0].ownerClerkUserId ?? "") === String(userId)) {
        tenant = rows[0];
      }
    }

    // 2) Fallback: most recent tenant owned by this user
    if (!tenant) {
      const rows = await db.execute(sql`
        select id, name, slug, owner_clerk_user_id
        from tenants
        where owner_clerk_user_id = ${userId}
        order by created_at desc
        limit 1
      `);

      const row: any =
        (rows as any)?.rows?.[0] ?? (Array.isArray(rows) ? (rows as any)[0] : null);

      if (row) {
        tenant = {
          id: row.id,
          name: row.name,
          slug: row.slug,
          ownerClerkUserId: row.owner_clerk_user_id,
        };
      }
    }

    if (!tenant) return json({ ok: false, error: "NO_TENANT" }, 404);

    const sRows = await db
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenant.id))
      .limit(1);

    const s: any = sRows[0] ?? null;

    // Return BOTH snake_case and camelCase for URL fields to avoid UI drift.
    const settings = s
      ? {
          tenant_id: s.tenantId,
          industry_key: s.industryKey ?? null,

          // snake_case (what your UI expects)
          redirect_url: s.redirectUrl ?? null,
          thank_you_url: s.thankYouUrl ?? null,

          // camelCase (what some older UI variants used)
          redirectUrl: s.redirectUrl ?? null,
          thankYouUrl: s.thankYouUrl ?? null,

          updated_at: s.updatedAt ? String(s.updatedAt) : null,
        }
      : null;

    return json({
      ok: true,
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      settings,
    });
  } catch (e: any) {
    return json(
      { ok: false, error: "ME_SETTINGS_FAILED", message: e?.message ?? String(e) },
      500
    );
  }
}
