// src/app/api/admin/dashboard/metrics/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq, gte, lt, sql, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs, tenants } from "@/lib/db/schema";

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

function setTenantCookies(res: NextResponse, tenantId: string) {
  const isProd = process.env.NODE_ENV === "production";
  const opts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProd,
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  };

  // set BOTH keys because your code checks multiple names
  res.cookies.set("activeTenantId", tenantId, opts);
  res.cookies.set("active_tenant_id", tenantId, opts);
  res.cookies.set("tenantId", tenantId, opts);
  res.cookies.set("tenant_id", tenantId, opts);

  return res;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "UNAUTHENTICATED", message: "Sign in required." },
        { status: 401 }
      );
    }

    const jar = await cookies();
    let tenantId = getTenantIdFromCookies(jar);

    // If cookie missing (fresh device), auto-pick first owned tenant (Option B behavior)
    if (!tenantId) {
      const first = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.ownerClerkUserId, userId))
        .orderBy(tenants.createdAt)
        .limit(1)
        .then((r) => r[0]?.id ?? null);

      tenantId = first;

      // If user truly has no tenant, return zeros (don’t crash admin UI)
      if (!tenantId) {
        return NextResponse.json({
          ok: true,
          activeTenantId: null,
          metrics: {
            newLeads7d: 0,
            quoted7d: 0,
            avgResponseMinutes7d: null,
            renderEnabled: null,
          },

          // keep compatibility fields (optional)
          totalLeads: 0,
          unread: 0,
          stageNew: 0,
          inProgress: 0,
          todayNew: 0,
          yesterdayNew: 0,
          staleUnread: 0,
        });
      }
    }

    // Time windows
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const todayStart = startOfDay(now);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    const staleCutoff = new Date(now);
    staleCutoff.setHours(staleCutoff.getHours() - 24);

    // Stage grouping:
    // - "new" is NEW
    // - "read" | "estimate" | "quoted" = IN PROGRESS
    const inProgressStages = ["read", "estimate", "quoted"] as const;

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

    // in progress (all time)
    const inProgress = await db
      .select({ c: sql<number>`count(*)` })
      .from(quoteLogs)
      .where(and(eq(quoteLogs.tenantId, tenantId), inArray(quoteLogs.stage, [...inProgressStages])))
      .then((r) => Number(r?.[0]?.c ?? 0));

    // today new leads
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

    // yesterday new leads
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

    // stale unread (>24h old and unread)
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

    // DashboardClient expects this shape:
    const newLeads7d = await db
      .select({ c: sql<number>`count(*)` })
      .from(quoteLogs)
      .where(and(eq(quoteLogs.tenantId, tenantId), gte(quoteLogs.createdAt, sevenDaysAgo)))
      .then((r) => Number(r?.[0]?.c ?? 0));

    // treat stage === "quoted" as "quoted in last 7 days" (good enough for now)
    const quoted7d = await db
      .select({ c: sql<number>`count(*)` })
      .from(quoteLogs)
      .where(
        and(
          eq(quoteLogs.tenantId, tenantId),
          gte(quoteLogs.createdAt, sevenDaysAgo),
          eq(quoteLogs.stage, "quoted")
        )
      )
      .then((r) => Number(r?.[0]?.c ?? 0));

    // You don’t have response timestamps wired here yet, keep null for now
    const avgResponseMinutes7d: number | null = null;

    // You can wire this later from ai_policy; for now return null so UI doesn’t crash
    const renderEnabled: boolean | null = null;

    const out = NextResponse.json({
      ok: true,
      activeTenantId: tenantId,
      metrics: { newLeads7d, quoted7d, avgResponseMinutes7d, renderEnabled },

      // keep your existing fields too (harmless + useful)
      totalLeads,
      unread,
      stageNew,
      inProgress,
      todayNew,
      yesterdayNew,
      staleUnread,
    });

    // If we had to auto-pick tenantId because cookie was missing, set cookies now
    if (!getTenantIdFromCookies(jar)) {
      return setTenantCookies(out, tenantId);
    }

    return out;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}