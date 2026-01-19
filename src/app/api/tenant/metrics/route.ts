import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, count, eq, gte, lt } from "drizzle-orm";

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

async function countRange(tenantId: string, start: Date, end: Date) {
  const total = await db
    .select({ n: count() })
    .from(quoteLogs)
    .where(
      and(eq(quoteLogs.tenantId, tenantId), gte(quoteLogs.createdAt, start), lt(quoteLogs.createdAt, end))
    )
    .then((r) => Number(r[0]?.n ?? 0));

  const optIn = await db
    .select({ n: count() })
    .from(quoteLogs)
    .where(
      and(
        eq(quoteLogs.tenantId, tenantId),
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
        eq(quoteLogs.tenantId, tenantId),
        gte(quoteLogs.createdAt, start),
        lt(quoteLogs.createdAt, end),
        eq(quoteLogs.renderStatus, "rendered")
      )
    )
    .then((r) => Number(r[0]?.n ?? 0));

  const failed = await db
    .select({ n: count() })
    .from(quoteLogs)
    .where(
      and(
        eq(quoteLogs.tenantId, tenantId),
        gte(quoteLogs.createdAt, start),
        lt(quoteLogs.createdAt, end),
        eq(quoteLogs.renderStatus, "failed")
      )
    )
    .then((r) => Number(r[0]?.n ?? 0));

  return { total, optIn, rendered, failed };
}

function pctChange(thisVal: number, lastVal: number) {
  if (lastVal === 0 && thisVal === 0) return 0;
  if (lastVal === 0) return 100;
  return ((thisVal - lastVal) / lastVal) * 100;
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

    // Rolling windows (stable every day of week)
    const now = new Date();
    const msDay = 24 * 60 * 60 * 1000;

    const endThis = now;
    const startThis = new Date(now.getTime() - 7 * msDay);

    const endLast = startThis;
    const startLast = new Date(startThis.getTime() - 7 * msDay);

    const thisPeriod = await countRange(tenantId, startThis, endThis);
    const lastPeriod = await countRange(tenantId, startLast, endLast);

    return NextResponse.json({
      ok: true,
      range: {
        thisStart: startThis.toISOString(),
        thisEnd: endThis.toISOString(),
        lastStart: startLast.toISOString(),
        lastEnd: endLast.toISOString(),
      },
      thisPeriod,
      lastPeriod,
      deltaPct: {
        total: pctChange(thisPeriod.total, lastPeriod.total),
        optIn: pctChange(thisPeriod.optIn, lastPeriod.optIn),
        rendered: pctChange(thisPeriod.rendered, lastPeriod.rendered),
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e ?? "Unknown error") },
      { status: 500 }
    );
  }
}
