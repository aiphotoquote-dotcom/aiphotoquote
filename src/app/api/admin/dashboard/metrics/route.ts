// src/app/api/admin/dashboard/metrics/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requireTenantRole } from "@/lib/auth/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      pragma: "no-cache",
      expires: "0",
    },
  });
}

function firstRow(r: any): any | null {
  return (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
}

/**
 * Dashboard metrics for active tenant.
 * Uses created_at (NOT submitted_at).
 */
export async function GET() {
  const gate = await requireTenantRole(["owner", "admin", "member"]);
  if (!gate.ok) return json({ ok: false, error: gate.error, message: gate.message }, gate.status);

  try {
    // quote_logs columns assumed: tenant_id, created_at, is_read, stage
    const r = await db.execute(sql`
      WITH base AS (
        SELECT
          tenant_id,
          created_at,
          COALESCE(is_read, false) AS is_read,
          COALESCE(stage, 'new') AS stage
        FROM quote_logs
        WHERE tenant_id = ${gate.tenantId}::uuid
      )
      SELECT
        COALESCE((SELECT COUNT(*)::int FROM base), 0) AS "totalLeads",
        COALESCE((SELECT COUNT(*)::int FROM base WHERE is_read = false), 0) AS "unread",
        COALESCE((SELECT COUNT(*)::int FROM base WHERE lower(stage) = 'new'), 0) AS "stageNew",
        COALESCE((SELECT COUNT(*)::int FROM base WHERE lower(stage) IN ('read','estimate','quoted')), 0) AS "inProgress",
        COALESCE((
          SELECT COUNT(*)::int
          FROM base
          WHERE created_at >= date_trunc('day', now())
            AND created_at <  date_trunc('day', now()) + interval '1 day'
        ), 0) AS "todayNew",
        COALESCE((
          SELECT COUNT(*)::int
          FROM base
          WHERE created_at >= date_trunc('day', now()) - interval '1 day'
            AND created_at <  date_trunc('day', now())
        ), 0) AS "yesterdayNew",
        COALESCE((
          SELECT COUNT(*)::int
          FROM base
          WHERE is_read = false
            AND created_at < now() - interval '24 hours'
        ), 0) AS "staleUnread"
    `);

    const row = firstRow(r) ?? {};

    return json({
      ok: true,
      totalLeads: Number(row.totalLeads ?? 0),
      unread: Number(row.unread ?? 0),
      stageNew: Number(row.stageNew ?? 0),
      inProgress: Number(row.inProgress ?? 0),
      todayNew: Number(row.todayNew ?? 0),
      yesterdayNew: Number(row.yesterdayNew ?? 0),
      staleUnread: Number(row.staleUnread ?? 0),
    });
  } catch (e: any) {
    return json(
      {
        ok: false,
        error: "METRICS_QUERY_FAILED",
        message: e?.message ?? String(e),
        code: e?.code,
        detail: e?.detail,
        hint: e?.hint,
      },
      500
    );
  }
}