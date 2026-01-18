// src/app/api/tenant/me-settings/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants, tenantSettings } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns the active tenant + its tenant_settings row for the current user context.
 *
 * How we determine "active tenant":
 *  1) cookie activeTenantId / active_tenant_id / tenantId / tenant_id
 *  2) fallback: first tenant (by created_at) as a safe default for now
 *
 * NOTE: This is intentionally lightweight and tenant-centric.
 * It does NOT return secrets.
 */
export async function GET() {
  try {
    const jar = await cookies();

    const candidates = [
      jar.get("activeTenantId")?.value,
      jar.get("active_tenant_id")?.value,
      jar.get("tenantId")?.value,
      jar.get("tenant_id")?.value,
    ]
      .map((s) => String(s || "").trim())
      .filter(Boolean);

    let tenant = null as any;

    // 1) If cookie present, try that tenant id first
    if (candidates.length) {
      const tenantId = candidates[0];

      // If your Drizzle instance doesn't have db.query.* enabled, use select().
      tenant = await db
        .select({
          id: tenants.id,
          name: tenants.name,
          slug: tenants.slug,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1)
        .then((rows) => rows[0] ?? null);
    }

    // 2) Fallback: first tenant
    if (!tenant) {
      tenant = await db
        .select({
          id: tenants.id,
          name: tenants.name,
          slug: tenants.slug,
        })
        .from(tenants)
        .orderBy(tenants.createdAt)
        .limit(1)
        .then((rows) => rows[0] ?? null);
    }

    if (!tenant) {
      return NextResponse.json(
        { ok: false, error: "NO_TENANT", message: "No tenant found for this account yet." },
        { status: 404 }
      );
    }

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
      .then((rows) => rows[0] ?? null);

    return NextResponse.json(
      {
        ok: true,
        tenant,
        settings,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("ME_SETTINGS_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "ME_SETTINGS_ERROR", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
