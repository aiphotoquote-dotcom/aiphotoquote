// src/app/api/tenant/metrics-week/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";

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

// Monday 00:00:00 UTC for the week containing `d`
function startOfWeekUtc(d: Date) {
  const x = new Date(d);
  // convert to "UTC midnight today" first, then roll back to Monday
  const utc = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate(), 0, 0, 0, 0));
  const day = utc.getUTCDay(); // 0 Sun .. 6 Sat
  const diff = (day + 6) % 7; // days since Monday
  utc.setUTCDate(utc.getUTCDate() - diff);
  return utc;
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

    // UTC week bounds
    const thisWeekStart = startOfWeekUtc(now);
    const nextWeekStart = new Date(thisWeekStart);
    nextWeekStart.setUTCDate(thisWeekStart.getUTCDate() + 7);

    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setUTCDate(thisWeekStart.getUTCDate() - 7);

    // One query: tenant filtered once, counts via FILTER
    const row = await db
      .select({
        quotesThis: sql<number>`
          count(*) filter (
            where ${quoteLogs.createdAt} >= ${thisWeekStart}
              and ${quoteLogs.createdAt} < ${nextWeekStart}
          )::int
        `.mapWith(Number),
        quotesLast: sql<number>`
          count(*) filter (
            where ${quoteLogs.createdAt} >= ${lastWeekStart}
              and ${quoteLogs.createdAt} < ${thisWeekStart}
          )::int
        `.mapWith(Number),

        optinsThis: sql<number>`
          count(*) filter (
            where ${quoteLogs.createdAt} >= ${thisWeekStart}
              and ${quoteLogs.createdAt} < ${nextWeekStart}
              and ${quoteLogs.renderOptIn} = true
          )::int
        `.mapWith(Number),
        optinsLast: sql<number>`
          count(*) filter (
            where ${quoteLogs.createdAt} >= ${lastWeekStart}
              and ${quoteLogs.createdAt} < ${thisWeekStart}
              and ${quoteLogs.renderOptIn} = true
          )::int
        `.mapWith(Number),

        renderedThis: sql<number>`
          count(*) filter (
            where ${quoteLogs.createdAt} >= ${thisWeekStart}
              and ${quoteLogs.createdAt} < ${nextWeekStart}
              and lower(coalesce(${quoteLogs.renderStatus}, '')) = 'rendered'
          )::int
        `.mapWith(Number),
        renderedLast: sql<number>`
          count(*) filter (
            where ${quoteLogs.createdAt} >= ${lastWeekStart}
              and ${quoteLogs.createdAt} < ${thisWeekStart}
              and lower(coalesce(${quoteLogs.renderStatus}, '')) = 'rendered'
          )::int
        `.mapWith(Number),

        failedThis: sql<number>`
          count(*) filter (
            where ${quoteLogs.createdAt} >= ${thisWeekStart}
              and ${quoteLogs.createdAt} < ${nextWeekStart}
              and lower(coalesce(${quoteLogs.renderStatus}, '')) = 'failed'
          )::int
        `.mapWith(Number),
        failedLast: sql<number>`
          count(*) filter (
            where ${quoteLogs.createdAt} >= ${lastWeekStart}
              and ${quoteLogs.createdAt} < ${thisWeekStart}
              and lower(coalesce(${quoteLogs.renderStatus}, '')) = 'failed'
          )::int
        `.mapWith(Number),
      })
      .from(quoteLogs)
      .where(eq(quoteLogs.tenantId, tenantId))
      .then((r) => r[0]);

    return NextResponse.json({
      ok: true,
      range: {
        thisWeekStart: thisWeekStart.toISOString(),
        nextWeekStart: nextWeekStart.toISOString(),
        lastWeekStart: lastWeekStart.toISOString(),
        lastWeekEnd: thisWeekStart.toISOString(),
      },
      thisWeek: {
        quotes: row?.quotesThis ?? 0,
        renderOptIns: row?.optinsThis ?? 0,
        rendered: row?.renderedThis ?? 0,
        renderFailures: row?.failedThis ?? 0,
      },
      lastWeek: {
        quotes: row?.quotesLast ?? 0,
        renderOptIns: row?.optinsLast ?? 0,
        rendered: row?.renderedLast ?? 0,
        renderFailures: row?.failedLast ?? 0,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
