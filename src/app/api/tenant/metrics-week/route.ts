import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenantSettings, tenants } from "@/lib/db/schema";

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

    // Load reporting settings (defaults if missing)
    const s = await db
      .select({
        reportingTimezone: tenantSettings.reportingTimezone,
        weekStartsOn: tenantSettings.weekStartsOn,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId))
      .limit(1)
      .then((r) => r[0] ?? null);

    const tz = (s?.reportingTimezone ?? "America/New_York").toString();
    const weekStartsOn = typeof s?.weekStartsOn === "number" ? s!.weekStartsOn! : 1; // default Monday

    // offsetDays = (8 - weekStartsOn) % 7
    // weekStartsOn: 0=Sun -> off=1, 1=Mon -> off=0, 2=Tue -> off=6, etc
    const offsetDays = (8 - weekStartsOn) % 7;

    const result = await db.execute(sql`
      with
        cfg as (
          select
            ${tz}::text as tz,
            ${offsetDays}::int as off
        ),
        bounds as (
          select
            (now() at time zone (select tz from cfg)) as local_now
        ),
        w as (
          select
            (
              date_trunc('week', (select local_now from bounds) + (select off from cfg) * interval '1 day')
              - (select off from cfg) * interval '1 day'
            ) as this_start_local
        ),
        t as (
          select
            (this_start_local at time zone (select tz from cfg)) as this_start,
            ((this_start_local + interval '7 days') at time zone (select tz from cfg)) as this_end,
            ((this_start_local - interval '7 days') at time zone (select tz from cfg)) as last_start,
            (this_start_local at time zone (select tz from cfg)) as last_end
          from w
        )
      select
        (select this_start from t) as this_start,
        (select this_end   from t) as this_end,
        (select last_start from t) as last_start,
        (select last_end   from t) as last_end,

        count(*) filter (where q.created_at >= (select this_start from t) and q.created_at < (select this_end from t))::int as quotes_this,
        count(*) filter (where q.created_at >= (select last_start from t) and q.created_at < (select last_end from t))::int as quotes_last,

        count(*) filter (where q.created_at >= (select this_start from t) and q.created_at < (select this_end from t) and q.render_opt_in = true)::int as optins_this,
        count(*) filter (where q.created_at >= (select last_start from t) and q.created_at < (select last_end from t) and q.render_opt_in = true)::int as optins_last,

        count(*) filter (where q.created_at >= (select this_start from t) and q.created_at < (select this_end from t) and lower(coalesce(q.render_status,'')) = 'rendered')::int as rendered_this,
        count(*) filter (where q.created_at >= (select last_start from t) and q.created_at < (select last_end from t) and lower(coalesce(q.render_status,'')) = 'rendered')::int as rendered_last,

        count(*) filter (where q.created_at >= (select this_start from t) and q.created_at < (select this_end from t) and lower(coalesce(q.render_status,'')) = 'failed')::int as failed_this,
        count(*) filter (where q.created_at >= (select last_start from t) and q.created_at < (select last_end from t) and lower(coalesce(q.render_status,'')) = 'failed')::int as failed_last
      from quote_logs q
      where q.tenant_id = ${tenantId}::uuid;
    `);

    const row: any =
      Array.isArray((result as any).rows) ? (result as any).rows[0] : (result as any)[0];

    if (!row) {
      return NextResponse.json({
        ok: true,
        reporting: { timezone: tz, week_starts_on: weekStartsOn },
        range: null,
        thisWeek: { quotes: 0, renderOptIns: 0, rendered: 0, renderFailures: 0 },
        lastWeek: { quotes: 0, renderOptIns: 0, rendered: 0, renderFailures: 0 },
      });
    }

    return NextResponse.json({
      ok: true,
      reporting: { timezone: tz, week_starts_on: weekStartsOn },
      range: {
        thisWeekStart: new Date(row.this_start).toISOString(),
        nextWeekStart: new Date(row.this_end).toISOString(),
        lastWeekStart: new Date(row.last_start).toISOString(),
      },
      thisWeek: {
        quotes: row.quotes_this ?? 0,
        renderOptIns: row.optins_this ?? 0,
        rendered: row.rendered_this ?? 0,
        renderFailures: row.failed_this ?? 0,
      },
      lastWeek: {
        quotes: row.quotes_last ?? 0,
        renderOptIns: row.optins_last ?? 0,
        rendered: row.rendered_last ?? 0,
        renderFailures: row.failed_last ?? 0,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
