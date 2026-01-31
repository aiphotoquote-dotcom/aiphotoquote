// src/app/api/tenant/metrics/route.ts
import { NextResponse } from "next/server";
import { and, count, eq, gte, lt } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs } from "@/lib/db/schema";
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

async function countRange(tenantId: string, start: Date, end: Date) {
  const total = await db
    .select({ n: count() })
    .from(quoteLogs)
    .where(and(eq(quoteLogs.tenantId, tenantId as any), gte(quoteLogs.createdAt, start), lt(quoteLogs.createdAt, end)))
    .then((r) => Number(r[0]?.n ?? 0));

  const optIn = await db
    .select({ n: count() })
    .from(quoteLogs)
    .where(
      and(
        eq(quoteLogs.tenantId, tenantId as any),
        gte(quoteLogs.createdAt, start),
        lt(quoteLogs.createdAt, end),
        eq(quoteLogs.renderOptIn, true)
      )
    )
    .then((r) => Number(r[0]?.n ?? 0));

  const rendered = await db
    .select({ n: count() })
    .from(quoteLogs)
    .where(
      and(
        eq(quoteLogs.tenantId, tenantId as any),
        gte(quoteLogs.createdAt, start),
        lt(quoteLogs.createdAt, end),
        eq(quoteLogs.renderStatus, "rendered" as any)
      )
    )
    .then((r) => Number(r[0]?.n ?? 0));

  const failed = await db
    .select({ n: count() })
    .from(quoteLogs)
    .where(
      and(
        eq(quoteLogs.tenantId, tenantId as any),
        gte(quoteLogs.createdAt, start),
        lt(quoteLogs.createdAt, end),
        eq(quoteLogs.renderStatus, "failed" as any)
      )
    )
    .then((r) => Number(r[0]?.n ?? 0));

  return { total, optIn, rendered, failed };
}

/**
 * Tenant metrics (RBAC + active tenant via requireTenantRole).
 * NOTE: This endpoint is “rolling last 7 days vs previous 7 days”.
 */
export async function GET() {
  const gate = await requireTenantRole(["owner", "admin", "member"]);
  if (!gate.ok) return json({ ok: false, error: gate.error, message: gate.message }, gate.status);

  try {
    const now = new Date();
    const msDay = 24 * 60 * 60 * 1000;

    // rolling 7-day window
    const thisEnd = now;
    const thisStart = new Date(now.getTime() - 7 * msDay);

    const lastEnd = thisStart;
    const lastStart = new Date(thisStart.getTime() - 7 * msDay);

    const thisPeriod = await countRange(gate.tenantId, thisStart, thisEnd);
    const lastPeriod = await countRange(gate.tenantId, lastStart, lastEnd);

    const pct = (a: number, b: number) => {
      if (b === 0 && a === 0) return 0;
      if (b === 0) return 100;
      return ((a - b) / b) * 100;
    };

    return json({
      ok: true,
      tenantId: gate.tenantId,
      role: gate.role,
      range: {
        thisStart: thisStart.toISOString(),
        thisEnd: thisEnd.toISOString(),
        lastStart: lastStart.toISOString(),
        lastEnd: lastEnd.toISOString(),
      },
      thisPeriod,
      lastPeriod,
      deltaPct: {
        total: pct(thisPeriod.total, lastPeriod.total),
        optIn: pct(thisPeriod.optIn, lastPeriod.optIn),
        rendered: pct(thisPeriod.rendered, lastPeriod.rendered),
        failed: pct(thisPeriod.failed, lastPeriod.failed),
      },
    });
  } catch (e: any) {
    return json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e ?? "Unknown error") },
      500
    );
  }
}