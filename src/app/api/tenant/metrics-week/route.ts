import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs, tenants } from "@/lib/db/schema";

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

    // Fallback: tenant owned by user
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

    // last 7 days
    const rows = await db
      .select({
        quotes7d: sql<number>`count(*)::int`,
        rendersRequested7d: sql<number>`sum(case when ${quoteLogs.renderOptIn} = true then 1 else 0 end)::int`,
        rendersCompleted7d: sql<number>`sum(case when ${quoteLogs.renderStatus} = 'rendered' then 1 else 0 end)::int`,
        rendersFailed7d: sql<number>`sum(case when ${quoteLogs.renderStatus} = 'failed' then 1 else 0 end)::int`,
        lastQuoteAt: sql<Date | null>`max(${quoteLogs.createdAt})`,
      })
      .from(quoteLogs)
      .where(
        sql`${quoteLogs.tenantId} = ${tenantId} and ${quoteLogs.createdAt} >= (now() - interval '7 days')`
      );

    const r = rows?.[0] ?? {
      quotes7d: 0,
      rendersRequested7d: 0,
      rendersCompleted7d: 0,
      rendersFailed7d: 0,
      lastQuoteAt: null,
    };

    const requested = Number(r.rendersRequested7d ?? 0);
    const completed = Number(r.rendersCompleted7d ?? 0);
    const successRate = requested > 0 ? Math.round((completed / requested) * 100) : null;

    return NextResponse.json({
      ok: true,
      tenantId,
      metrics: {
        quotes7d: Number(r.quotes7d ?? 0),
        rendersRequested7d: requested,
        rendersCompleted7d: completed,
        rendersFailed7d: Number(r.rendersFailed7d ?? 0),
        renderSuccessRatePct: successRate, // null when requested=0
        lastQuoteAt: r.lastQuoteAt ? new Date(r.lastQuoteAt).toISOString() : null,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}