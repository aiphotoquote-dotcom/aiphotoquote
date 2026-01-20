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
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }

    const jar = await cookies();
    let tenantId = getCookieTenantId(jar);

    // Fallback: if cookie isn't set, use the first tenant owned by this user
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
      return NextResponse.json({ ok: false, error: "NO_ACTIVE_TENANT" }, { status: 400 });
    }

    const tenantRow = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!tenantRow) {
      return NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND" }, { status: 404 });
    }

    const settingsRow = await db
      .select({
        tenant_id: tenantSettings.tenantId,
        industry_key: tenantSettings.industryKey,
        redirect_url: tenantSettings.redirectUrl,
        thank_you_url: tenantSettings.thankYouUrl,
        updated_at: tenantSettings.updatedAt,

        // ✅ new reporting fields (snake_case in response)
        time_zone: tenantSettings.timeZone,
        week_start: tenantSettings.weekStart,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId))
      .limit(1)
      .then((r) => r[0] ?? null);

    // Defaulting (keep UI stable even if null in DB)
    const tz = (settingsRow as any)?.time_zone ?? "America/New_York";
    const ws = (settingsRow as any)?.week_start ?? "monday";

    const settings =
      settingsRow
        ? { ...settingsRow, time_zone: tz, week_start: ws }
        : null;

    return NextResponse.json({
      ok: true,
      tenant: tenantRow,
      settings,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
