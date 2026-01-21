// src/app/api/admin/dashboard/metrics/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq, gte, lt, sql, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getTenantIdFromCookies(jar: any) {
  return (
    jar.get("activeTenantId")?.value ||
    jar.get("active_tenant_id")?.value ||
    jar.get("tenantId")?.value ||
    jar.get("tenant_id")?.value ||
    null
  );
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export async function GET() {
  try {
    const jar = await cookies();
    const tenantId = getTenantIdFromCookies(jar);
    if (!tenantId) {
      return NextResponse.json(
        { ok: false, error: "NO_ACTIVE_TENANT", message: "No active tenant selected." },
        { status: 400 }
      );
    }

    const now = new Date();
    const todayStart = startOfDay(now);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    const staleCutoff = new Date(now);
    staleCutoff.setHours(staleCutoff.getHours() - 24);

    // Stage grouping:
    // - "new" is NEW
    // - "read" | "estimate" | "quoted" = IN PROGRESS (per your request)
    const inProgressStages = ["read", "estimate", "quoted"];

    // total leads (all time)
    const totalLeads = await db
      .select({ c: sql<number>`count(*)` })
      .from(quoteLogs)
      .where(eq(quoteLogs.tenantId, tenantId))
      .then((r) => Number(r?.[0]?.c ?? 0));

    // unread (all time)
    const unread = await db
      .select({ c: sql<number>`count(*)` })
      .from(quoteLogs)
      .where(and(eq(quoteLogs.tenantId, tenantId), eq(quoteLogs.isRead, false)))
      .then((r) => Number(r?.[0]?.c ?? 0));

    // stage: new (all time)
    const stageNew = await db
      .select({ c: sql<number>`count(*)` })
      .from(quoteLogs)
      .where(and(eq(quoteLogs.tenantId, tenantId), eq(quoteLogs.stage, "new")))
      .then((r) => Number(r?.[0]?.c ?? 0));

    // in progress (all time): read/estimate/quoted only
    const inProgress = await db
      .select({ c: sql<number>`count(*)` })
      .from(quoteLogs)
      .where(and(eq(quoteLogs.tenantId, tenantId), inArray(quoteLogs.stage, inProgressStages)))
      .then((r) => Number(r?.[0]?.c ?? 0));

    // today new leads (created today)
    const todayNew = await db
      .select({ c: sql<number>`count(*)` })
      .from(quoteLogs)
      .where(and(eq(quoteLogs.tenantId, tenantId), gte(quoteLogs.createdAt, todayStart), lt(quoteLogs.createdAt, tomorrowStart)))
      .then((r) => Number(r?.[0]?.c ?? 0));

    // yesterday new leads
    const yesterdayNew = await db
      .select({ c: sql<number>`count(*)` })
      .from(quoteLogs)
      .where(and(eq(quoteLogs.tenantId, tenantId), gte(quoteLogs.createdAt, yesterdayStart), lt(quoteLogs.createdAt, todayStart)))
      .then((r) => Number(r?.[0]?.c ?? 0));

    // stale unread (>24h old and unread)
    const staleUnread = await db
      .select({ c: sql<number>`count(*)` })
      .from(quoteLogs)
      .where(and(eq(quoteLogs.tenantId, tenantId), eq(quoteLogs.isRead, false), lt(quoteLogs.createdAt, staleCutoff)))
      .then((r) => Number(r?.[0]?.c ?? 0));

    return NextResponse.json({
      ok: true,
      totalLeads,
      unread,
      stageNew,
      inProgress,
      todayNew,
      yesterdayNew,
      staleUnread,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}