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

function clampWeekStartsOn(v: unknown) {
  // stored as 0..6 (Sun..Sat). Default Monday=1.
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 1;
  const i = Math.trunc(n);
  if (i < 0) return 0;
  if (i > 6) return 6;
  return i;
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

    // Pull tenant reporting preferences (timezone + week start)
    const s = await db
      .select({
        reportingTimezone: tenantSettings.reportingTimezone,
        weekStartsOn: tenantSettings.weekStartsOn,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId))
      .limit(1)
      .then((r) => r[0] ?? null);

    const tz =
      typeof s?.reportingTimezone === "string" && s.reportingTimezone.trim()
        ? s.reportingTimezone.trim()
        : "America/New_York";

    const weekStartsOn = clampWeekStartsOn(s?.weekStartsOn);

    // Compute week bounds in *tenant timezone* with *tenant week start*
    // Then count all metrics in one query using FILTER.
    //
    // Key idea:
    // - take "today" in tenant TZ as a DATE
    // - compute start date by subtracting day-diff based on desired DOW (0 Sun..6 Sat)
    // - convert local midnight timestamps back into timestamptz via "AT TIME ZONE tz"
    const q = await db.execute(
      sql`
        with cfg as (
          select
            ${tz}::text as tz,
            ${weekStartsOn}::int as ws
        ),
        local_today as (
          select
            (now() at time zone (select tz from cfg))::date as today,
            (select tz from cfg) as tz,
            (select ws from cfg) as ws
        ),
        dates as (
          select
            -- extract(dow) uses 0=Sun .. 6=Sat (matches our stored convention)
            (today - ((extract(dow from today)::int - ws + 7) % 7))::date as this_start_date,
            (today - ((extract(dow from today)::int - ws + 7) % 7) - 7)::date as last_start_date,
            tz
          from local_today
        ),
        bounds as (
          select
            (this_start_date::timestamp at time zone tz) as this_start,
            ((this_start_date::timestamp + interval '7 days') at time zone tz) as this_end,
            (last_start_date::timestamp at time zone tz) as last_start,
            ((last_start_date::timestamp + interval '7 days') at time zone tz) as last_end
          from dates
        )
        select
          b.this_start,
          b.this_end,
          b.last_start,
          b.last_end,

          count(*) filter (
            where q.created_at >= b.this_start and q.created_at < b.this_end
          )::int as quotes_this,

          count(*) filter (
            where q.created_at >= b.last_start and q.created_at < b.last_end
          )::int as quotes_last,

          count(*) filter (
            where q.created_at >= b.this_start and q.created_at < b.this_end
              and q.render_opt_in = true
          )::int as optins_this,

          count(*) filter (
            where q.created_at >= b.last_start and q.created_at < b.last_end
              and q.render_opt_in = true
          )::int as optins_last,

          count(*) filter (
            where q.created_at >= b.this_start and q.created_at < b.this_end
              and lower(coalesce(q.render_status, '')) = 'rendered'
          )::int as rendered_this,

          count(*) filter (
            where q.created_at >= b.last_start and q.created_at < b.last_end
              and lower(coalesce(q.render_status, '')) = 'rendered'
          )::int as rendered_last,

          count(*) filter (
            where q.created_at >= b.this_start and q.created_at < b.this_end
              and lower(coalesce(q.render_status, '')) = 'failed'
          )::int as failed_this,

          count(*) filter (
            where q.created_at >= b.last_start and q.created_at < b.last_end
              and lower(coalesce(q.render_status, '')) = 'failed'
          )::int as failed_last

        from quote_logs q
        cross join bounds b
        where q.tenant_id = ${tenantId};
      `
    );

    // drizzle returns { rows } with driver-specific shapes
    const row: any =
      (q as any)?.rows?.[0] ??
      (Array.isArray(q) ? (q as any)[0] : null) ??
      null;

    if (!row) {
      // If no rows came back, still return range (compute range without counts would be extra query)
      return NextResponse.json({
        ok: true,
        reporting: { timezone: tz, weekStartsOn },
        range: null,
        thisWeek: { quotes: 0, renderOptIns: 0, rendered: 0, renderFailures: 0 },
        lastWeek: { quotes: 0, renderOptIns: 0, rendered: 0, renderFailures: 0 },
      });
    }

    const thisStart = row.this_start ? new Date(row.this_start).toISOString() : null;
    const thisEnd = row.this_end ? new Date(row.this_end).toISOString() : null;
    const lastStart = row.last_start ? new Date(row.last_start).toISOString() : null;
    const lastEnd = row.last_end ? new Date(row.last_end).toISOString() : null;

    return NextResponse.json({
      ok: true,
      reporting: { timezone: tz, weekStartsOn },
      range: {
        thisWeekStart: thisStart,
        nextWeekStart: thisEnd,
        lastWeekStart: lastStart,
        lastWeekEnd: lastEnd,
      },
      thisWeek: {
        quotes: Number(row.quotes_this ?? 0) || 0,
        renderOptIns: Number(row.optins_this ?? 0) || 0,
        rendered: Number(row.rendered_this ?? 0) || 0,
        renderFailures: Number(row.failed_this ?? 0) || 0,
      },
      lastWeek: {
        quotes: Number(row.quotes_last ?? 0) || 0,
        renderOptIns: Number(row.optins_last ?? 0) || 0,
        rendered: Number(row.rendered_last ?? 0) || 0,
        renderFailures: Number(row.failed_last ?? 0) || 0,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
