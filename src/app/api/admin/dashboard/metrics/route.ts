// src/app/api/admin/dashboard/metrics/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants, quoteLogs } from "@/lib/db/schema";
import { requireAppUserId } from "@/lib/auth/requireAppUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TENANT_COOKIE_KEYS = ["activeTenantId", "active_tenant_id", "tenantId", "tenant_id"] as const;

function getTenantIdFromCookies(jar: any) {
  for (const k of TENANT_COOKIE_KEYS) {
    const v = jar.get(k)?.value;
    if (v) return v;
  }
  return null;
}

function setTenantCookies(res: NextResponse, tenantId: string) {
  const isProd = process.env.NODE_ENV === "production";
  const opts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProd,
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  };

  res.cookies.set("activeTenantId", tenantId, opts);
  res.cookies.set("active_tenant_id", tenantId, opts);
  res.cookies.set("tenantId", tenantId, opts);
  res.cookies.set("tenant_id", tenantId, opts);
  return res;
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }

    // mobility layer / app_user exists
    await requireAppUserId();

    const jar = await cookies();
    let tenantId = getTenantIdFromCookies(jar);

    // Find tenants (for now: owned by this user)
    const owned = await db
      .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.ownerClerkUserId, userId))
      .orderBy(tenants.createdAt);

    // Option B behavior:
    // - if no cookie and exactly one tenant -> auto-select + set cookies
    // - if no cookie and multiple -> require explicit selection
    if (!tenantId) {
      if (owned.length === 1) {
        tenantId = owned[0].id;

        const sevenDaysAgo = daysAgo(7);

        const newLeads7d = await db
          .select({ c: sql<number>`count(*)` })
          .from(quoteLogs)
          .where(and(eq(quoteLogs.tenantId, tenantId), gte(quoteLogs.createdAt, sevenDaysAgo)))
          .then((r) => Number(r?.[0]?.c ?? 0));

        const quoted7d = await db
          .select({ c: sql<number>`count(*)` })
          .from(quoteLogs)
          .where(
            and(
              eq(quoteLogs.tenantId, tenantId),
              eq(quoteLogs.stage, "quoted"),
              gte(quoteLogs.createdAt, sevenDaysAgo)
            )
          )
          .then((r) => Number(r?.[0]?.c ?? 0));

        // If you don’t have timestamps to compute this yet, keep null.
        const avgResponseMinutes7d: number | null = null;

        // If you later wire AI policy -> return real boolean. For now keep null.
        const renderEnabled: boolean | null = null;

        const res = NextResponse.json({
          ok: true,
          metrics: {
            newLeads7d,
            quoted7d,
            avgResponseMinutes7d,
            renderEnabled,
          },
        });

        return setTenantCookies(res, tenantId);
      }

      return NextResponse.json(
        {
          ok: false,
          error: "NO_ACTIVE_TENANT",
          message:
            owned.length > 1
              ? "Multiple tenants found. Please select a tenant."
              : "No tenant found for this user.",
          tenants: owned.map((t) => ({ id: t.id, slug: t.slug, name: t.name })),
        },
        { status: 400 }
      );
    }

    // Normal path: tenant cookie exists
    const sevenDaysAgo = daysAgo(7);

    const newLeads7d = await db
      .select({ c: sql<number>`count(*)` })
      .from(quoteLogs)
      .where(and(eq(quoteLogs.tenantId, tenantId), gte(quoteLogs.createdAt, sevenDaysAgo)))
      .then((r) => Number(r?.[0]?.c ?? 0));

    const quoted7d = await db
      .select({ c: sql<number>`count(*)` })
      .from(quoteLogs)
      .where(
        and(eq(quoteLogs.tenantId, tenantId), eq(quoteLogs.stage, "quoted"), gte(quoteLogs.createdAt, sevenDaysAgo))
      )
      .then((r) => Number(r?.[0]?.c ?? 0));

    const avgResponseMinutes7d: number | null = null;
    const renderEnabled: boolean | null = null;

    return NextResponse.json({
      ok: true,
      metrics: {
        newLeads7d,
        quoted7d,
        avgResponseMinutes7d,
        renderEnabled,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}