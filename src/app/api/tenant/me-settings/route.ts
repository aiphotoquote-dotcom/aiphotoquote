import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants, tenantSettings } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function getActiveTenantIdFromCookies() {
  // Try a few common names (yours may be one of these already)
  const jar = cookies();
  const candidates = [
    jar.get("activeTenantId")?.value,
    jar.get("active_tenant_id")?.value,
    jar.get("tenantId")?.value,
    jar.get("tenant_id")?.value,
    jar.get("apq_tenant_id")?.value,
  ]
    .map((x) => (x ? String(x) : ""))
    .filter(Boolean);

  const found = candidates.find((v) => looksLikeUuid(v));
  return found || null;
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

    // 1) Prefer active tenant cookie (multi-tenant friendly)
    const activeTenantId = getActiveTenantIdFromCookies();

    let tenantRow:
      | { id: string; name: string; slug: string; ownerClerkUserId: string | null }
      | null = null;

    if (activeTenantId) {
      const rows = await db
        .select({
          id: tenants.id,
          name: tenants.name,
          slug: tenants.slug,
          ownerClerkUserId: tenants.ownerClerkUserId,
        })
        .from(tenants)
        .where(eq(tenants.id, activeTenantId))
        .limit(1);

      tenantRow = rows[0] ?? null;
    }

    // 2) Fallback: owner lookup (works even without tenant_members)
    if (!tenantRow) {
      const rows = await db
        .select({
          id: tenants.id,
          name: tenants.name,
          slug: tenants.slug,
          ownerClerkUserId: tenants.ownerClerkUserId,
        })
        .from(tenants)
        .where(eq(tenants.ownerClerkUserId, userId))
        .limit(1);

      tenantRow = rows[0] ?? null;
    }

    if (!tenantRow) {
      return NextResponse.json(
        {
          ok: false,
          error: "NO_TENANT",
          message:
            "No tenant found for this user (and no active tenant cookie set).",
        },
        { status: 404 }
      );
    }

    const settingsRows = await db
      .select({
        tenant_id: tenantSettings.tenantId,
        industry_key: tenantSettings.industryKey,
        redirect_url: tenantSettings.redirectUrl,
        thank_you_url: tenantSettings.thankYouUrl,
        updated_at: tenantSettings.updatedAt,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantRow.id))
      .limit(1);

    const s = settingsRows[0] ?? null;

    return NextResponse.json(
      {
        ok: true,
        tenant: {
          id: tenantRow.id,
          name: tenantRow.name,
          slug: tenantRow.slug,
        },
        settings: s
          ? {
              tenant_id: s.tenant_id,
              industry_key: s.industry_key ?? null,
              redirect_url: s.redirect_url ?? null,
              thank_you_url: s.thank_you_url ?? null,
              updated_at: s.updated_at ? new Date(s.updated_at).toISOString() : null,
            }
          : null,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("ME_SETTINGS_ERROR", err);
    return NextResponse.json(
      {
        ok: false,
        error: "ME_SETTINGS_ERROR",
        message: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}
