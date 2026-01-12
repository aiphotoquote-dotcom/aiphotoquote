// src/app/api/tenant/me-settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { db } from "../../../../lib/db/client";
import { tenants, tenantSettings } from "../../../../lib/db/schema";

export const runtime = "nodejs";

function safeDbError(err: any) {
  return {
    message: err?.message ?? String(err),
    code: err?.code ?? null,
    detail: err?.detail ?? null,
    hint: err?.hint ?? null,
    where: err?.where ?? null,
    routine: err?.routine ?? null,
    schema: err?.schema ?? null,
    table: err?.table ?? null,
    column: err?.column ?? null,
    constraint: err?.constraint ?? null,
  };
}

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

    // This is the query that is currently failing in prod. We'll surface the REAL error.
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
      { ok: false, error: { code: "INTERNAL", db: safeDbError(err) } },
      { status: 500 }
    );
  }
}
