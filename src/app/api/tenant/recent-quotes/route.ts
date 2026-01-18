import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs, tenants } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function GET() {
  try {
    const session = await auth();
    const userId = session.userId;

    if (!userId) {
      return json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }

    // Resolve tenant owned by this user (single-tenant owner model for now)
    // IMPORTANT: this matches your current approach used elsewhere.
    const tenantRows = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        ownerClerkUserId: tenants.ownerClerkUserId,
      })
      .from(tenants)
      .where(eq(tenants.ownerClerkUserId, userId))
      .limit(1);

    const tenant = tenantRows?.[0] ?? null;

    if (!tenant?.id) {
      return json(
        { ok: false, error: "NO_TENANT", message: "No tenant found for this user." },
        { status: 404 }
      );
    }

    const rows = await db
      .select({
        id: quoteLogs.id,
        createdAt: quoteLogs.createdAt,
        confidence: quoteLogs.confidence,
        estimateLow: quoteLogs.estimateLow,
        estimateHigh: quoteLogs.estimateHigh,
        inspectionRequired: quoteLogs.inspectionRequired,

        renderOptIn: quoteLogs.renderOptIn,
        renderStatus: quoteLogs.renderStatus,
        renderImageUrl: quoteLogs.renderImageUrl,

        // keep input/output optional for later drill-in (not needed on dashboard)
      })
      .from(quoteLogs)
      .where(eq(quoteLogs.tenantId, tenant.id))
      .orderBy(desc(quoteLogs.createdAt))
      .limit(10);

    return json(
      {
        ok: true,
        tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
        quotes: rows,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
