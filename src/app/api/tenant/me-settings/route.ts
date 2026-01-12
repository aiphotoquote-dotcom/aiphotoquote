// src/app/api/tenant/me-settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";

import { db } from "../../../../lib/db/client";
import { tenants } from "../../../../lib/db/schema";

export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const tenantRows = await db
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.ownerClerkUserId, userId))
      .limit(1);

    const tenant = tenantRows[0];
    if (!tenant?.id) {
      return NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND" }, { status: 404 });
    }

    // ✅ Query ONLY what we have proven exists: tenant_id
    // Next step we’ll expand after we inspect actual column names.
    const settingsRows = await db.execute(sql`
      select "tenant_id"
      from "tenant_settings"
      where "tenant_id" = ${tenant.id}::uuid
      limit 1
    `);

    const s0 = (settingsRows as any)?.[0] ?? null;

    return NextResponse.json({
      ok: true,
      tenant,
      settings: s0, // currently { tenant_id: ... }
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL", message: err?.message || String(err) } },
      { status: 500 }
    );
  }
}
