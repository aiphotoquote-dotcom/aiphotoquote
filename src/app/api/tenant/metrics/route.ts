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

// ISO week (Monday 00:00:00 UTC)
function startOfIsoWeekUTC(d: Date) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1 - day); // shift back to Monday
  date.setUTCDate(date.getUTCDate() + diff);
  date.setUTCHours(0, 0, 0, 0);
  return date;
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
  // total
  const total = await db
    .select({ n: count() })
    .from(quoteLogs)
    .where(and(eq(quoteLogs.tenantId, tenantId), gte(quoteLogs.createdAt, start), lt(quoteLogs.createdAt, end)))
    .then((r) => Number(r[0]?.n ?? 0));

  // render opt-ins
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

  // rendered
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

  // failed
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

    const now = new Date();
    const thisWeekStart = startOfIsoWeekUTC(now);
    const nextWeekStart = new Date(thisWeekStart);
    nextWeekStart.setUTCDate(nextWeekStart.getUTCDate() + 7);

    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 7);

    const lastWeekEnd = new Date(thisWeekStart);

    const thisWeek = await countRange(tenantId, thisWeekStart, nextWeekStart);
    const lastWeek = await countRange(tenantId, lastWeekStart, lastWeekEnd);

    return NextResponse.json({
      ok: true,
      range: {
        thisWeekStart: thisWeekStart.toISOString(),
        lastWeekStart: lastWeekStart.toISOString(),
      },
      thisWeek,
      lastWeek,
      deltaPct: {
        total: pctChange(thisWeek.total, lastWeek.total),
        optIn: pctChange(thisWeek.optIn, lastWeek.optIn),
        rendered: pctChange(thisWeek.rendered, lastWeek.rendered),
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e ?? "Unknown error") },
      { status: 500 }
    );
  }
}
