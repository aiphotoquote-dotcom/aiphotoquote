// src/app/api/admin/dashboard/metrics/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq, inArray, gte, desc, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs, tenants } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function digitsOnly(s: string) {
  return (s || "").replace(/\D/g, "");
}
function formatUSPhone(raw: string) {
  const d = digitsOnly(raw).slice(0, 10);
  const a = d.slice(0, 3);
  const b = d.slice(3, 6);
  const c = d.slice(6, 10);
  if (!d) return "";
  if (d.length <= 3) return a ? `(${a}` : "";
  if (d.length <= 6) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}

function pickLead(input: any) {
  const c = input?.customer ?? input?.contact ?? input ?? null;

  const name =
    c?.name ??
    input?.name ??
    input?.customer_name ??
    input?.customerName ??
    "New customer";

  const phone =
    c?.phone ??
    c?.phoneNumber ??
    input?.phone ??
    input?.customer_phone ??
    input?.customerPhone ??
    input?.customer_context?.phone ??
    null;

  const email =
    c?.email ??
    input?.email ??
    input?.customer_email ??
    input?.customerEmail ??
    input?.customer_context?.email ??
    null;

  const phoneDigits = phone ? digitsOnly(String(phone)) : "";

  return {
    name: String(name || "New customer"),
    phone: phoneDigits ? formatUSPhone(phoneDigits) : null,
    email: email ? String(email) : null,
  };
}

function getActiveTenantIdFromCookies(jar: Awaited<ReturnType<typeof cookies>>) {
  return (
    jar.get("activeTenantId")?.value ||
    jar.get("active_tenant_id")?.value ||
    jar.get("tenantId")?.value ||
    jar.get("tenant_id")?.value ||
    null
  );
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }

    const jar = await cookies();
    const activeTenantId = getActiveTenantIdFromCookies(jar);

    if (!activeTenantId) {
      return NextResponse.json(
        { ok: false, error: "NO_ACTIVE_TENANT", message: "No active tenant selected." },
        { status: 400 }
      );
    }

    // Verify tenant belongs to this user (owner-based for now)
    const t = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.id, activeTenantId), eq(tenants.ownerClerkUserId, userId)))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!t) {
      return NextResponse.json(
        { ok: false, error: "TENANT_NOT_FOUND_OR_NOT_OWNED" },
        { status: 404 }
      );
    }

    const now = new Date();
    const last24hStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7dStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // --- KPIs ---
    const new24hRow = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(quoteLogs)
      .where(and(eq(quoteLogs.tenantId, activeTenantId), gte(quoteLogs.createdAt, last24hStart)))
      .then((r) => r[0]?.n ?? 0);

    const total7dRow = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(quoteLogs)
      .where(and(eq(quoteLogs.tenantId, activeTenantId), gte(quoteLogs.createdAt, last7dStart)))
      .then((r) => r[0]?.n ?? 0);

    const unreadRow = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(quoteLogs)
      .where(and(eq(quoteLogs.tenantId, activeTenantId), eq(quoteLogs.isRead, false)))
      .then((r) => r[0]?.n ?? 0);

    const needsActionRow = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(quoteLogs)
      .where(
        and(
          eq(quoteLogs.tenantId, activeTenantId),
          inArray(quoteLogs.stage, ["new", "estimate"])
        )
      )
      .then((r) => r[0]?.n ?? 0);

    const renderQueuedRow = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(quoteLogs)
      .where(
        and(
          eq(quoteLogs.tenantId, activeTenantId),
          inArray(quoteLogs.renderStatus, ["requested", "queued", "running", "rendering"])
        )
      )
      .then((r) => r[0]?.n ?? 0);

    // --- Recent 5 ---
    const recentRows = await db
      .select({
        id: quoteLogs.id,
        createdAt: quoteLogs.createdAt,
        stage: quoteLogs.stage,
        isRead: quoteLogs.isRead,
        renderStatus: quoteLogs.renderStatus,
        input: quoteLogs.input,
      })
      .from(quoteLogs)
      .where(eq(quoteLogs.tenantId, activeTenantId))
      .orderBy(desc(quoteLogs.createdAt))
      .limit(5);

    const recent = recentRows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt?.toISOString?.() ? r.createdAt.toISOString() : String(r.createdAt),
      stage: String(r.stage || "new"),
      isRead: Boolean(r.isRead),
      renderStatus: String(r.renderStatus || "not_requested"),
      lead: pickLead(r.input),
    }));

    return NextResponse.json({
      ok: true,
      tenantId: activeTenantId,
      window: {
        last24hStart: last24hStart.toISOString(),
        last7dStart: last7dStart.toISOString(),
      },
      kpis: {
        new24h: Number(new24hRow) || 0,
        total7d: Number(total7dRow) || 0,
        unread: Number(unreadRow) || 0,
        needsAction: Number(needsActionRow) || 0,
        renderQueued: Number(renderQueuedRow) || 0,
      },
      recent,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}