// src/app/api/admin/dashboard/metrics/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq, gte, lt, sql, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs, tenantSettings } from "@/lib/db/schema";

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

    const sevenDaysAgo = new Date(todayStart);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Stages:
    const inProgressStages = ["read", "estimate", "quoted"];

    // Totals (for your current dashboard UI chips/cards)
    const totalLeads = await db
      .select({ c: sql<number>`count(*)` })
      .from(quoteLogs)
      .where(eq(quoteLogs.tenantId, tenantId))
      .then((r) => Number(r?.[0]?.c ?? 0));

    const unread = await db
      .select({ c: sql<number>`count(*)` })
      .from(quoteLogs)
      .where(and(eq(quoteLogs.tenantId, tenantId), eq(quoteLogs.isRead, false)))
      .then((r) => Number(r?.[0]?.c ?? 0));

    const stageNew = await db
      .select({ c: sql<number>`count(*)` })
      .from(quoteLogs)
      .where(and(eq(quoteLogs.tenantId, tenantId), eq(quoteLogs.stage, "new")))
      .then((r) => Number(r?.[0]?.c ?? 0));

    const inProgress = await db
      .select({ c: sql<number>`count(*)` })
      .from(quoteLogs)
      .where(and(eq(quoteLogs.tenantId, tenantId), inArray(quoteLogs.stage, inProgressStages as any)))
      .then((r) => Number(r?.[0]?.c ?? 0));

    const todayNew = await db
      .select({ c: sql<number>`count(*)` })
      .from(quoteLogs)
      .where(
        and(
          eq(quoteLogs.tenantId, tenantId),
          gte(quoteLogs.createdAt, todayStart),
          lt(quoteLogs.createdAt, tomorrowStart)
        )
      )
      .then((r) => Number(r?.[0]?.c ?? 0));

    const yesterdayNew = await db
      .select({ c: sql<number>`count(*)` })
      .from(quoteLogs)
      .where(
        and(
          eq(quoteLogs.tenantId, tenantId),
          gte(quoteLogs.createdAt, yesterdayStart),
          lt(quoteLogs.createdAt, todayStart)
        )
      )
      .then((r) => Number(r?.[0]?.c ?? 0));

    const staleUnread = await db
      .select({ c: sql<number>`count(*)` })
      .from(quoteLogs)
      .where(
        and(
          eq(quoteLogs.tenantId, tenantId),
          eq(quoteLogs.isRead, false),
          lt(quoteLogs.createdAt, staleCutoff)
        )
      )
      .then((r) => Number(r?.[0]?.c ?? 0));

    // “Metrics” (for the newer dashboard client that expects metrics.*)
    const newLeads7d = await db
      .select({ c: sql<number>`count(*)` })
      .from(quoteLogs)
      .where(and(eq(quoteLogs.tenantId, tenantId), gte(quoteLogs.createdAt, sevenDaysAgo)))
      .then((r) => Number(r?.[0]?.c ?? 0));

    const quoted7d = await db
      .select({ c: sql<number>`count(*)` })
      .from(quoteLogs)
      .where(
        and(
          eq(quoteLogs.tenantId, tenantId),
          eq(quoteLogs.stage, "quoted"),
          gte(quoteLogs.createdAt, sevenDaysAgo)
        )
      )
      .then((r) => Number(r?.[0]?.c ?? 0));

    // If you don’t have a true response-time column yet, keep null
    const avgResponseMinutes7d: number | null = null;

    // Rendering enabled (if your tenantSettings has it; otherwise null)
    const renderEnabled = await db
      .select({
        v: (tenantSettings as any).aiRenderingEnabled ?? (tenantSettings as any).renderingEnabled,
      })
      .from(tenantSettings as any)
      .where(eq((tenantSettings as any).tenantId, tenantId))
      .limit(1)
      .then((r) => (typeof r?.[0]?.v === "boolean" ? r[0].v : null))
      .catch(() => null);

    return NextResponse.json({
      ok: true,

      // ✅ for current “chips/cards” dashboard UI
      totals: {
        totalLeads,
        unread,
        stageNew,
        inProgress,
        todayNew,
        yesterdayNew,
        staleUnread,
      },

      // ✅ for your newer “metrics grid” dashboard client
      metrics: {
        newLeads7d,
        quoted7d,
        avgResponseMinutes7d,
        renderEnabled,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}