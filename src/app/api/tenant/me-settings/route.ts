// src/app/api/tenant/me-settings/route.ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants, tenantSettings } from "@/lib/db/schema";
import { requireTenantRole } from "@/lib/auth/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      pragma: "no-cache",
      expires: "0",
    },
  });
}

/**
 * Tenant "me-settings" for the ACTIVE tenant.
 * RBAC + active tenant resolution is handled by requireTenantRole (cookie + tenant_members).
 *
 * IMPORTANT:
 * - No "fallback to first tenant" (causes tenant drift).
 * - If no active tenant cookie, client must call /api/tenant/context and/or use tenant switcher.
 */
export async function GET() {
  const gate = await requireTenantRole(["owner", "admin", "member"]);
  if (!gate.ok) return json({ ok: false, error: gate.error, message: gate.message }, gate.status);

  try {
    const tenant = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
      })
      .from(tenants)
      .where(eq(tenants.id, gate.tenantId as any))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!tenant) {
      return json({ ok: false, error: "TENANT_NOT_FOUND" }, 404);
    }

    // Only select columns that *exist* in prod
    const settings = await db
      .select({
        tenant_id: tenantSettings.tenantId,
        industry_key: tenantSettings.industryKey,
        redirect_url: tenantSettings.redirectUrl,
        thank_you_url: tenantSettings.thankYouUrl,
        updated_at: tenantSettings.updatedAt,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenant.id))
      .limit(1)
      .then((r) => r[0] ?? null);

    return json({ ok: true, tenant, settings });
  } catch (e: any) {
    return json(
      {
        ok: false,
        error: "INTERNAL",
        message: e?.message ?? String(e),
        code: e?.code,
        detail: e?.detail,
        hint: e?.hint,
      },
      500
    );
  }
}
