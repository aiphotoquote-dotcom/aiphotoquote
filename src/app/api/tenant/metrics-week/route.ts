// src/app/api/tenant/metrics-week/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq, gte, lt } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs, tenants } from "@/lib/db/schema";

export const runtime = "nodejs";

function getCookieTenantId(jar: Awaited<ReturnType<typeof cookies>>) {
  const candidates = [
    jar.get("activeTenantId")?.value,
    jar.get("active_tenant_id")?.value,
    jar.get("tenantId")?.value,
    jar.get("tenant_id")?.value,
  ].filter(Boolean) as string[];

  return candidates[0] || null;
}

function startOfWeek(d: Date) {
  // Monday 00:00:00 local time
  const x = new Date(d);
  const day = x.getDay(); // 0 Sun .. 6 Sat
  const diff = (day + 6) % 7; // how many days since Monday
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

async function countWhere(tenantId: string, start: Date, end: Date) {
  // Total quotes
  const quotes = await db
    .select({ id: quoteLogs.id })
    .from(quoteLogs)
    .where(
      and(
        eq(quoteLogs.tenantId, tenantId),
        gte(quoteLogs.createdAt, start),
        lt(quoteLogs.createdAt, end)
      )
    )
    .then((r) => r.length);

  // Render opt-ins
  const renderOptIns = await db
    .select({ id: quoteLogs.id })
    .from(quoteLogs)
    .where(
      and(
        eq(quoteLogs.tenantId, tenantId),
        gte(quoteLogs.createdAt, start),
        lt(quoteLogs.createdAt, end),
        eq(quoteLogs.renderOptIn, true)
      )
    )
    .then((r) => r.length);

  // Rendered
  const rendered = await db
    .select({ id: quoteLogs.id })
    .from(quoteLogs)
    .where(
      and(
        eq(quoteLogs.tenantId, tenantId),
        gte(quoteLogs.createdAt, start),
        lt(quoteLogs.createdAt, end),
        eq(quoteLogs.renderStatus, "rendered")
      )
    )
    .then((r) => r.length);

  // Render failures
  const renderFailures = await db
    .select({ id: quoteLogs.id })
    .from(quoteLogs)
    .where(
      and(
        eq(quoteLogs.tenantId, tenantId),
        gte(quoteLogs.createdAt, start),
        lt(quoteLogs.createdAt, end),
        eq(quoteLogs.renderStatus, "failed")
      )
    )
    .then((r) => r.length);

  return { quotes, renderOptIns, rendered, renderFailures };
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "UNAUTHENTICATED" },
        { status: 401 }
      );
    }

    const tenantId = await resolveTenantId(userId);
    if (!tenantId) {
      return NextResponse.json(
        { ok: false, error: "NO_ACTIVE_TENANT" },
        { status: 400 }
      );
    }

    const now = new Date();
    const thisWeekStart = startOfWeek(now);
    const nextWeekStart = new Date(thisWeekStart);
    nextWeekStart.setDate(thisWeekStart.getDate() + 7);

    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(thisWeekStart.getDate() - 7);

    const thisWeek = await countWhere(tenantId, thisWeekStart, nextWeekStart);
    const lastWeek = await countWhere(tenantId, lastWeekStart, thisWeekStart);

    return NextResponse.json({
      ok: true,
      range: {
        thisWeekStart: thisWeekStart.toISOString(),
        nextWeekStart: nextWeekStart.toISOString(),
        lastWeekStart: lastWeekStart.toISOString(),
      },
      thisWeek,
      lastWeek,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
