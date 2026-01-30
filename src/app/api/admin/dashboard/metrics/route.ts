// src/app/api/admin/dashboard/metrics/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { readActiveTenantIdFromCookies } from "@/lib/tenant/activeTenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TenantRole = "owner" | "admin" | "member";

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

async function getTenantRole(userId: string, tenantId: string): Promise<TenantRole | null> {
  const r = await db.execute(sql`
    SELECT role
    FROM tenant_members
    WHERE tenant_id = ${tenantId}::uuid
      AND clerk_user_id = ${userId}
      AND (status IS NULL OR status = 'active')
    LIMIT 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? null;
  const role = String(row?.role ?? "").trim();
  if (role === "owner" || role === "admin" || role === "member") return role;
  return null;
}

/**
 * IMPORTANT:
 * This endpoint must NEVER return ok:true with partial fields.
 * Always return the full metrics payload with numbers (0 if none).
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return json({ ok: false, error: "UNAUTHENTICATED" }, 401);

  const tenantId = await readActiveTenantIdFromCookies();
  if (!tenantId) return json({ ok: false, error: "NO_ACTIVE_TENANT", message: "Select a tenant first." }, 400);

  const role = await getTenantRole(userId, tenantId);
  if (!role) {
    return json(
      { ok: false, error: "FORBIDDEN", message: "No tenant access found for this user.", tenantId },
      403
    );
  }

  try {
    // NOTE: This assumes your leads live in "quote_logs" with these columns:
    // tenant_id, submitted_at, is_read, stage
    // If your table name/columns differ, tell me and I’ll adapt in one file.
    const res = await db.execute(sql`
      WITH base AS (
        SELECT
          tenant_id,
          submitted_at,
          COALESCE(is_read, false) AS is_read,
          COALESCE(stage, 'new') AS stage
        FROM quote_logs
        WHERE tenant_id = ${tenantId}::uuid
      )
      SELECT
        COALESCE((SELECT COUNT(*)::int FROM base), 0) AS "totalLeads",
        COALESCE((SELECT COUNT(*)::int FROM base WHERE is_read = false), 0) AS "unread",
        COALESCE((SELECT COUNT(*)::int FROM base WHERE lower(stage) = 'new'), 0) AS "stageNew",
        COALESCE((SELECT COUNT(*)::int FROM base WHERE lower(stage) IN ('read','estimate','quoted')), 0) AS "inProgress",
        COALESCE((
          SELECT COUNT(*)::int
          FROM base
          WHERE submitted_at >= date_trunc('day', now())
            AND submitted_at <  date_trunc('day', now()) + interval '1 day'
        ), 0) AS "todayNew",
        COALESCE((
          SELECT COUNT(*)::int
          FROM base
          WHERE submitted_at >= date_trunc('day', now()) - interval '1 day'
            AND submitted_at <  date_trunc('day', now())
        ), 0) AS "yesterdayNew",
        COALESCE((
          SELECT COUNT(*)::int
          FROM base
          WHERE is_read = false
            AND submitted_at < now() - interval '24 hours'
        ), 0) AS "staleUnread"
    `);

    const row: any = (res as any)?.rows?.[0] ?? null;

    // Hard guarantee types + presence (never return partial ok:true)
    const metrics = {
      totalLeads: Number(row?.totalLeads ?? 0),
      unread: Number(row?.unread ?? 0),
      stageNew: Number(row?.stageNew ?? 0),
      inProgress: Number(row?.inProgress ?? 0),
      todayNew: Number(row?.todayNew ?? 0),
      yesterdayNew: Number(row?.yesterdayNew ?? 0),
      staleUnread: Number(row?.staleUnread ?? 0),
    };

    return json({ ok: true, ...metrics });
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