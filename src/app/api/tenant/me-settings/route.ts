// src/app/api/tenant/me-settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { db } from "../../../../lib/db/client";
import { tenants, tenantSettings } from "../../../../lib/db/schema";

export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const tenantRows = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
      })
      .from(tenants)
      .where(eq(tenants.ownerClerkUserId, userId))
      .limit(1);

    const tenant = tenantRows[0];
    if (!tenant?.id) {
      return NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND" }, { status: 404 });
    }

    const settingsRows = await db
      .select({
        id: tenantSettings.id,
        tenantId: tenantSettings.tenantId,
        industryKey: tenantSettings.industryKey,
        redirectUrl: tenantSettings.redirectUrl,
        thankYouUrl: tenantSettings.thankYouUrl,
        createdAt: tenantSettings.createdAt,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenant.id))
      .limit(1);

    const settings = settingsRows[0] ?? null;

    return NextResponse.json({ ok: true, tenant, settings });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL", message: err?.message || String(err) } },
      { status: 500 }
    );
  }
}
