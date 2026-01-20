// src/app/api/tenant/metrics-week/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq, gte, lt } from "drizzle-orm";

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

// Monday 00:00:00 (UTC) start of week.
// This is stable + predictable. Later we can make it tenant-configurable.
function startOfWeekMondayUTC(d: Date) {
  const x = new Date(d);
  const day = x.getUTCDay(); // 0 Sun .. 6 Sat
  const diff = (day + 6) % 7; // days since Monday
  x.setUTCDate(x.getUTCDate() - diff);
  x.setUTCHours(0, 0, 0, 0);
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

async function countTotal(tenantId: string, start: Date, end: Date) {
  const rows = await db
    .select({ id: quoteLogs.id })
    .from(quoteLogs)
    .where(
      and(
        eq(quoteLogs.tenantId, tenantId),
        gte(quoteLogs.createdAt, start),
        lt(quoteLogs.createdAt, end)
      )
    );

  return rows.length;
}

async function countOptIns(tenantId: string, start: Date, end: Date) {
  const rows = await db
    .select({ id: quoteLogs.id })
    .from(quoteLogs)
    .where(
      and(
        eq(quoteLogs.tenantId, tenantId),
        gte(quoteLogs.createdAt, start),
        lt(quoteLogs.createdAt, end),
        eq(quoteLogs.renderOptIn, true)
      )
    );

  return rows.length;
}

async function countRendered(tenantId: string, start: Date, end: Date) {
  const rows = await db
    .select({ id: quoteLogs.id })
    .from(quoteLogs)
    .where(
      and(
        eq(quoteLogs.tenantId, tenantId),
        gte(quoteLogs.createdAt, start),
        lt(quoteLogs.createdAt, end),
        eq(quoteLogs.renderStatus, "rendered")
      )
    );

  return rows.length;
}

async function countFailed(tenantId: string, start: Date, end: Date) {
  const rows = await db
    .select({ id: quoteLogs.id })
    .from(quoteLogs)
    .where(
      and(
        eq(quoteLogs.tenantId, tenantId),
        gte(quoteLogs.createdAt, start),
        lt(quoteLogs.createdAt, end),
        eq(quoteLogs.renderStatus, "failed")
      )
    );

  return rows.length;
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

    // Week bounds (UTC Monday)
    const thisWeekStart = startOfWeekMondayUTC(now);
    const nextWeekStart = new Date(thisWeekStart);
    nextWeekStart.setUTCDate(nextWeekStart.getUTCDate() + 7);

    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 7);

    const thisWeekEnd = nextWeekStart;
    const lastWeekEnd = thisWeekStart;

    const [qThis, qLast, oThis, oLast, rThis, rLast, fThis, fLast] = await Promise.all([
      countTotal(tenantId, thisWeekStart, thisWeekEnd),
      countTotal(tenantId, lastWeekStart, lastWeekEnd),

      countOptIns(tenantId, thisWeekStart, thisWeekEnd),
      countOptIns(tenantId, lastWeekStart, lastWeekEnd),

      countRendered(tenantId, thisWeekStart, thisWeekEnd),
      countRendered(tenantId, lastWeekStart, lastWeekEnd),

      countFailed(tenantId, thisWeekStart, thisWeekEnd),
      countFailed(tenantId, lastWeekStart, lastWeekEnd),
    ]);

    return NextResponse.json({
      ok: true,
      weekStart: "monday",
      tz: "UTC",
      range: {
        thisWeekStart: thisWeekStart.toISOString(),
        nextWeekStart: nextWeekStart.toISOString(),
        lastWeekStart: lastWeekStart.toISOString(),
      },
      thisWeek: {
        quotes: qThis,
        renderOptIns: oThis,
        rendered: rThis,
        renderFailures: fThis,
      },
      lastWeek: {
        quotes: qLast,
        renderOptIns: oLast,
        rendered: rLast,
        renderFailures: fLast,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
