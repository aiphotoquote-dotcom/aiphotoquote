// src/app/api/tenant/save-settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";

import { db } from "../../../../lib/db/client";
import { tenants, tenantSettings } from "../../../../lib/db/schema";

export const runtime = "nodejs";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });

    const body = await req.json().catch(() => ({}));

    // Accept both camelCase and snake_case inputs (admin UI might vary)
    const industryKey =
      body.industryKey ?? body.industry_key ?? body.industry ?? null;

    const redirectUrl =
      body.redirectUrl ?? body.redirect_url ?? body.redirect ?? null;

    const thankYouUrl =
      body.thankYouUrl ?? body.thank_you_url ?? body.thankYou ?? null;

    if (!industryKey || typeof industryKey !== "string") {
      return json(
        { ok: false, error: "industryKey is required" },
        { status: 400 }
      );
    }

    // 1) Resolve tenant for this user
    const tenantRows = await db
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.ownerClerkUserId, userId))
      .limit(1);

    const tenant = tenantRows[0];
    if (!tenant?.id) {
      return json({ ok: false, error: "TENANT_NOT_FOUND" }, { status: 404 });
    }

    const tenantId = tenant.id;

    // 2) Upsert tenant_settings keyed by tenant_id (PK)
    // We do it in two steps to stay compatible across Postgres setups.
    const existing = await db
      .select({ tenantId: tenantSettings.tenantId })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(tenantSettings).values({
        tenantId,
        industryKey,
        redirectUrl,
        thankYouUrl,
        updatedAt: sql`now()`,
      });
    } else {
      await db
        .update(tenantSettings)
        .set({
          industryKey,
          redirectUrl,
          thankYouUrl,
          updatedAt: sql`now()`,
        })
        .where(eq(tenantSettings.tenantId, tenantId));
    }

    // 3) Return saved row (real DB columns via schema)
    const saved = await db
      .select({
        tenantId: tenantSettings.tenantId,
        industryKey: tenantSettings.industryKey,
        redirectUrl: tenantSettings.redirectUrl,
        thankYouUrl: tenantSettings.thankYouUrl,
        updatedAt: tenantSettings.updatedAt,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId))
      .limit(1);

    return json({
      ok: true,
      tenant,
      settings: saved[0] ?? null,
    });
  } catch (err: any) {
    return json(
      { ok: false, error: { code: "INTERNAL", message: err?.message || String(err) } },
      { status: 500 }
    );
  }
}
