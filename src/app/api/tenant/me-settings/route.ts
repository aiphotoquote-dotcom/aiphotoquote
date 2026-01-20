// src/app/api/tenant/me-settings/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants, tenantSettings } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getCookieTenantId(jar: Awaited<ReturnType<typeof cookies>>) {
  const candidates = [
    jar.get("activeTenantId")?.value,
    jar.get("active_tenant_id")?.value,
    jar.get("tenantId")?.value,
    jar.get("tenant_id")?.value,
  ].filter(Boolean) as string[];

  return candidates[0] || null;
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "UNAUTHENTICATED" },
        { status: 401 }
      );
    }

    const jar = await cookies();
    let tenantId = getCookieTenantId(jar);

    // fallback to tenant owned by user
    if (!tenantId) {
      const t = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.ownerClerkUserId, userId))
        .limit(1)
        .then((r) => r[0] ?? null);

      tenantId = t?.id ?? null;
    }

    if (!tenantId) {
      return NextResponse.json(
        { ok: false, error: "NO_ACTIVE_TENANT" },
        { status: 400 }
      );
    }

    const tenant = await db
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!tenant) {
      return NextResponse.json(
        { ok: false, error: "TENANT_NOT_FOUND" },
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

        // NEW reporting fields (snake_case in response)
        reporting_timezone: tenantSettings.reportingTimezone,
        week_starts_on: tenantSettings.weekStartsOn,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenant.id))
      .limit(1)
      .then((r) => r[0] ?? null);

    return NextResponse.json({
      ok: true,
      tenant,
      settings,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
