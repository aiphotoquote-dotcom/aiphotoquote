// src/app/api/tenant/metrics-week/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants, tenantSettings } from "@/lib/db/schema";

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

type Counts = {
  quotes: number;
  renderOptIns: number;
  rendered: number;
  renderFailures: number;
};

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

    const s = await db
      .select({
        weekStart: tenantSettings.weekStart,
        timeZone: tenantSettings.timeZone,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId))
      .limit(1)
      .then((r) => r[0] ?? null);

    // Defaults (you asked: Monday default)
    const weekStart = (s?.weekStart ?? "monday").toLowerCase();
    const timeZone = s?.timeZone ?? "America/New_York";

    // If weekStart is "sunday", shift local time by +1 day before date_trunc('week'),
    // then shift start back by -1 day. Monday is Postgres default for date_trunc('week').
    const weekStartExpr =
      weekStart === "sunday"
        ? sql`(date_trunc('week', timezone(${timeZone}, now()) + interval '1 day') - interval '1 day')`
        : sql`(date_trunc('week', timezone(${timeZone}, now())))`;

    const rows = await db.execute(sql<{
      this_start_utc: Date;
      this_end_utc: Date;
      last_start_utc: Date;
      last_end_utc: Date;
      quotes_this: number;
      quotes_last: number;
      optins_this: number;
      optins_last: number;
      rendered_this: number;
      rendered_last: number;
      failed_this: number;
      failed_last: number;
    }>`
      with bounds as (
        select
          (${weekStartExpr} at time zone ${timeZone}) as this_start_utc,
          ((${weekStartExpr} + interval '7 days') at time zone ${timeZone}) as this_end_utc,
          ((${weekStartExpr} - interval '7 days') at time zone ${timeZone}) as last_start_utc,
          (${weekStartExpr} at time zone ${timeZone}) as last_end_utc
      )
      select
        b.this_start_utc,
        b.this_end_utc,
        b.last_start_utc,
        b.last_end_utc,

        count(*) filter (
          where q.created_at >= b.this_start_utc and q.created_at < b.this_end_utc
        )::int as quotes_this,
        count(*) filter (
          where q.created_at >= b.last_start_utc and q.created_at < b.last_end_utc
        )::int as quotes_last,

        count(*) filter (
          where q.created_at >= b.this_start_utc and q.created_at < b.this_end_utc
            and q.render_opt_in = true
        )::int as optins_this,
        count(*) filter (
          where q.created_at >= b.last_start_utc and q.created_at < b.last_end_utc
            and q.render_opt_in = true
        )::int as optins_last,

        count(*) filter (
          where q.created_at >= b.this_start_utc and q.created_at < b.this_end_utc
            and lower(coalesce(q.render_status, '')) = 'rendered'
        )::int as rendered_this,
        count(*) filter (
          where q.created_at >= b.last_start_utc and q.created_at < b.last_end_utc
            and lower(coalesce(q.render_status, '')) = 'rendered'
        )::int as rendered_last,

        count(*) filter (
          where q.created_at >= b.this_start_utc and q.created_at < b.this_end_utc
            and lower(coalesce(q.render_status, '')) = 'failed'
        )::int as failed_this,
        count(*) filter (
          where q.created_at >= b.last_start_utc and q.created_at < b.last_end_utc
            and lower(coalesce(q.render_status, '')) = 'failed'
        )::int as failed_last

      from quote_logs q
      cross join bounds b
      where q.tenant_id = ${tenantId};
    `);

    const r = (rows as any)?.rows?.[0] ?? null;
    if (!r) {
      return NextResponse.json({
        ok: true,
        tz: timeZone,
        weekStart,
        range: null,
        thisWeek: { quotes: 0, renderOptIns: 0, rendered: 0, renderFailures: 0 },
        lastWeek: { quotes: 0, renderOptIns: 0, rendered: 0, renderFailures: 0 },
      });
    }

    const thisWeek: Counts = {
      quotes: Number(r.quotes_this ?? 0),
      renderOptIns: Number(r.optins_this ?? 0),
      rendered: Number(r.rendered_this ?? 0),
      renderFailures: Number(r.failed_this ?? 0),
    };

    const lastWeek: Counts = {
      quotes: Number(r.quotes_last ?? 0),
      renderOptIns: Number(r.optins_last ?? 0),
      rendered: Number(r.rendered_last ?? 0),
      renderFailures: Number(r.failed_last ?? 0),
    };

    return NextResponse.json({
      ok: true,
      tz: timeZone,
      weekStart,
      range: {
        thisWeekStart: new Date(r.this_start_utc).toISOString(),
        nextWeekStart: new Date(r.this_end_utc).toISOString(),
        lastWeekStart: new Date(r.last_start_utc).toISOString(),
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
