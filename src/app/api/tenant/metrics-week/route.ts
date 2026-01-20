// src/app/api/tenant/metrics-week/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq, gte, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs, tenants } from "@/lib/db/schema";

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

// Monday 00:00 local time
function startOfWeekMonday(d: Date) {
  const x = new Date(d);
  const day = x.getDay(); // 0 Sun .. 6 Sat
  const diff = (day + 6) % 7; // days since Monday
  x.setDate(x.getDate() - diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

async function resolveTenantId(userId: string) {
  const jar = await cookies();
  let tenantId = getCookieTenantId(jar);

  if (!tenantId) {
    const t = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.ownerClerkUserId, userId))
      .limit(1)
      .then((r) => r[0] ?? null);

    tenantId = t?.id ?? null;
  }

  return tenantId;
}

async function countMetrics(tenantId: string, start: Date, end: Date) {
  const base = and(
    eq(quoteLogs.tenantId, tenantId),
    gte(quoteLogs.createdAt, start),
    lt(quoteLogs.createdAt, end)
  );

  const quotes = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(quoteLogs)
    .where(base)
    .then((r) => r[0]?.n ?? 0);

  const renderOptIns = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(quoteLogs)
    .where(and(base, eq(quoteLogs.renderOptIn, true)))
    .then((r) => r[0]?.n ?? 0);

  const rendered = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(quoteLogs)
    .where(and(base, eq(quoteLogs.renderStatus, "rendered")))
    .then((r) => r[0]?.n ?? 0);

  const renderFailures = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(quoteLogs)
    .where(and(base, eq(quoteLogs.renderStatus, "failed")))
    .then((r) => r[0]?.n ?? 0);

  return { quotes, renderOptIns, rendered, renderFailures };
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }

    const tenantId = await resolveTenantId(userId);
    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "NO_ACTIVE_TENANT" }, { status: 400 });
    }

    const now = new Date();
    const thisStart = startOfWeekMonday(now);
    const thisEnd = new Date(thisStart);
    thisEnd.setDate(thisStart.getDate() + 7);

    const lastStart = new Date(thisStart);
    lastStart.setDate(thisStart.getDate() - 7);
    const lastEnd = new Date(thisStart);

    const thisWeek = await countMetrics(tenantId, thisStart, thisEnd);
    const lastWeek = await countMetrics(tenantId, lastStart, lastEnd);

    return NextResponse.json(
      {
        ok: true,
        thisWeek,
        lastWeek,
        meta: {
          tenantId,
          // purely informational for UI; not DB-enforced yet
          timeZone: "America/New_York",
          weekStartsOn: "monday",
          thisWeekStart: thisStart.toISOString(),
          thisWeekEnd: thisEnd.toISOString(),
          lastWeekStart: lastStart.toISOString(),
          lastWeekEnd: lastEnd.toISOString(),
        },
      },
      { headers: { "cache-control": "no-store, max-age=0" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
