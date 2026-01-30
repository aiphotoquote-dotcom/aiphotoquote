// src/app/api/tenant/context/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { requireAppUserId } from "@/lib/auth/requireAppUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tenantId: z.string().uuid().optional(),
  tenantSlug: z.string().min(3).optional(),
});

const COOKIE_KEYS = ["activeTenantId", "active_tenant_id", "tenantId", "tenant_id"] as const;

function setTenantCookies(res: NextResponse, tenantId: string) {
  const isProd = process.env.NODE_ENV === "production";

  const opts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProd,
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  };

  // Keep multiple keys for backwards compat (we can prune later)
  for (const k of COOKIE_KEYS) {
    res.cookies.set(k, tenantId, opts);
  }

  return res;
}

function clearTenantCookies(res: NextResponse) {
  // ✅ Most compatible signature across Next versions/types:
  // NextResponse.cookies.delete(name: string)
  for (const k of COOKIE_KEYS) {
    res.cookies.delete(k);
  }
  return res;
}

function readActiveTenantIdFromCookies(): string | null {
  const jar = cookies();
  for (const k of COOKIE_KEYS) {
    const v = jar.get(k)?.value;
    if (v) return v;
  }
  return null;
}

/**
 * GET: returns tenant context for the signed-in user.
 * Also sets cookie automatically when there's exactly one tenant.
 * Validates stale cookies (cookie must belong to returned tenant list).
 */
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }

    await requireAppUserId();

    const cookieTenantId = readActiveTenantIdFromCookies();

    // (For now) tenants = those owned by this Clerk user.
    const rows = await db
      .select({
        tenantId: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        createdAt: tenants.createdAt,
      })
      .from(tenants)
      .where(eq(tenants.ownerClerkUserId, userId))
      .orderBy(tenants.createdAt);

    const tenantList = rows.map((t) => ({
      tenantId: t.tenantId,
      slug: t.slug,
      name: t.name,
      role: "owner" as const,
    }));

    // If cookie exists, ensure it is valid for this user
    if (cookieTenantId) {
      const isValid = tenantList.some((t) => t.tenantId === cookieTenantId);
      if (isValid) {
        return NextResponse.json({
          ok: true,
          activeTenantId: cookieTenantId,
          tenants: tenantList,
          needsTenantSelection: false,
        });
      }

      // Stale/bad cookie: clear it, then continue as if missing
      const res = NextResponse.json({
        ok: true,
        activeTenantId: null,
        tenants: tenantList,
        needsTenantSelection: tenantList.length !== 1,
        clearedStaleCookie: true,
      });

      clearTenantCookies(res);

      // If exactly 1 tenant, immediately set correct one
      if (tenantList.length === 1) return setTenantCookies(res, tenantList[0].tenantId);

      return res;
    }

    // No cookie:
    if (tenantList.length === 0) {
      return NextResponse.json({
        ok: true,
        activeTenantId: null,
        tenants: [],
        needsTenantSelection: true,
      });
    }

    if (tenantList.length === 1) {
      const res = NextResponse.json({
        ok: true,
        activeTenantId: tenantList[0].tenantId,
        tenants: tenantList,
        needsTenantSelection: false,
        autoSelected: true,
      });
      return setTenantCookies(res, tenantList[0].tenantId);
    }

    return NextResponse.json({
      ok: true,
      activeTenantId: null,
      tenants: tenantList,
      needsTenantSelection: true,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

/**
 * POST: set active tenant cookie (must be owned by this user for now)
 */
export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }

    await requireAppUserId();

    const json = await req.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "INVALID_BODY", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { tenantId, tenantSlug } = parsed.data;
    if (!tenantId && !tenantSlug) {
      return NextResponse.json({ ok: false, error: "MISSING_TENANT_SELECTOR" }, { status: 400 });
    }

    const where =
      tenantId && tenantSlug
        ? and(eq(tenants.id, tenantId), eq(tenants.slug, tenantSlug), eq(tenants.ownerClerkUserId, userId))
        : tenantId
        ? and(eq(tenants.id, tenantId), eq(tenants.ownerClerkUserId, userId))
        : and(eq(tenants.slug, tenantSlug!), eq(tenants.ownerClerkUserId, userId));

    const t = await db
      .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
      .from(tenants)
      .where(where)
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!t) {
      return NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND_OR_NOT_OWNED" }, { status: 404 });
    }

    const res = NextResponse.json({ ok: true, activeTenantId: t.id, tenant: t });
    return setTenantCookies(res, t.id);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}