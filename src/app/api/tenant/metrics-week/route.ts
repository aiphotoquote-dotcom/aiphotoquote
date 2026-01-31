// src/app/api/tenant/metrics-week/route.ts
import { NextResponse } from "next/server";
import { and, eq, gte, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs } from "@/lib/db/schema";
import { requireTenantRole } from "@/lib/auth/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Monday 00:00 local time (server time for now)
function startOfWeekMonday(d: Date) {
  const x = new Date(d);
  const day = x.getDay(); // 0 Sun .. 6 Sat
  const diff = (day + 6) % 7; // days since Monday
  x.setDate(x.getDate() - diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

async function countMetrics(tenantId: string, start: Date, end: Date) {
  const base = and(eq(quoteLogs.tenantId, tenantId as any), gte(quoteLogs.createdAt, start), lt(quoteLogs.createdAt, end));

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
  // RBAC + active tenant resolution (cookie) is centralized here
  const gate = await requireTenantRole(["owner", "admin", "member"]);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error, message: gate.message },
      {
        status: gate.status,
        headers: { "cache-control": "no-store, max-age=0" },
      }
    );
  }

  try {
    const tenantId = gate.tenantId;

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
      { status: 500, headers: { "cache-control": "no-store, max-age=0" } }
    );
  }
}