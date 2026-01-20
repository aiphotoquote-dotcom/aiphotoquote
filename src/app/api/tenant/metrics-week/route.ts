// src/app/api/tenant/metrics-week/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";

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

function pctChange(thisVal: number, lastVal: number) {
  if (lastVal === 0) return thisVal === 0 ? 0 : 100;
  return Math.round(((thisVal - lastVal) / lastVal) * 100);
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

    // ✅ Do week boundaries in Postgres (avoids Vercel/UTC/local-time bugs)
    // Postgres date_trunc('week', now()) is Monday-start.
    // If you want Sunday-start later, we can adjust.
    const result = await db.execute(sql`
      with bounds as (
        select
          date_trunc('week', now()) as this_start,
          date_trunc('week', now()) + interval '7 days' as this_end,
          date_trunc('week', now()) - interval '7 days' as last_start,
          date_trunc('week', now()) as last_end
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
    `);

    const r0: any =
      (result as any)?.rows?.[0] ??
      (Array.isArray(result) ? (result as any)[0] : null) ??
      null;

    if (!r0) {
      return NextResponse.json({
        ok: true,
        tenantId,
        range: null,
        thisWeek: { quotes: 0, renderOptIns: 0, rendered: 0, renderFailures: 0 },
        lastWeek: { quotes: 0, renderOptIns: 0, rendered: 0, renderFailures: 0 },
        deltas: { quotesPct: 0, renderOptInsPct: 0, renderedPct: 0, renderFailuresPct: 0 },
      });
    }

    const thisWeek = {
      quotes: Number(r0.quotes_this ?? 0),
      renderOptIns: Number(r0.optins_this ?? 0),
      rendered: Number(r0.rendered_this ?? 0),
      renderFailures: Number(r0.failed_this ?? 0),
    };

    const lastWeek = {
      quotes: Number(r0.quotes_last ?? 0),
      renderOptIns: Number(r0.optins_last ?? 0),
      rendered: Number(r0.rendered_last ?? 0),
      renderFailures: Number(r0.failed_last ?? 0),
    };

    return NextResponse.json({
      ok: true,
      tenantId,
      range: {
        thisWeekStart: new Date(r0.this_start).toISOString(),
        nextWeekStart: new Date(r0.this_end).toISOString(),
        lastWeekStart: new Date(r0.last_start).toISOString(),
        lastWeekEnd: new Date(r0.last_end).toISOString(),
      },
      thisWeek,
      lastWeek,
      deltas: {
        quotesPct: pctChange(thisWeek.quotes, lastWeek.quotes),
        renderOptInsPct: pctChange(thisWeek.renderOptIns, lastWeek.renderOptIns),
        renderedPct: pctChange(thisWeek.rendered, lastWeek.rendered),
        renderFailuresPct: pctChange(thisWeek.renderFailures, lastWeek.renderFailures),
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
