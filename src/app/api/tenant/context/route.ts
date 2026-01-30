// src/app/api/tenant/context/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { requireAppUserId } from "@/lib/auth/requireAppUser";
import { readActiveTenantIdFromCookies, ACTIVE_TENANT_COOKIE_KEYS } from "@/lib/tenant/activeTenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tenantId: z.string().uuid().optional(),
  tenantSlug: z.string().min(3).optional(),
});

function cookieOpts() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProd,
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  };
}

/**
 * For now we write ALL legacy keys for backwards compat.
 * Later when everything reads only activeTenantId, we can stop writing the others.
 */
function setTenantCookies(res: NextResponse, tenantId: string) {
  const opts = cookieOpts();
  res.cookies.set("activeTenantId", tenantId, opts);
  res.cookies.set("active_tenant_id", tenantId, opts);
  res.cookies.set("tenantId", tenantId, opts);
  res.cookies.set("tenant_id", tenantId, opts);
  return res;
}

function clearTenantCookies(res: NextResponse) {
  // NextResponse.cookies.delete() expects:
  // - delete("name") OR delete({ name: "name", path: "/" })
  for (const name of ACTIVE_TENANT_COOKIE_KEYS) {
    res.cookies.delete({ name, path: "/" });
  }
  return res;
}

async function listTenantsForUser(userId: string) {
  // Owner-only model for now; later switch to tenant_members
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

  return rows.map((t) => ({
    tenantId: t.tenantId,
    slug: t.slug,
    name: t.name,
    role: "owner" as const,
  }));
}

/**
 * GET:
 * - returns tenant context for signed-in user
 * - if exactly 1 tenant and no cookie, auto-select and set cookie
 * - if cookie exists but is stale (not in tenant list), clear cookie and proceed
 */
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }

    // Ensure app_user exists (mobility layer)
    await requireAppUserId();

    const tenantsForUser = await listTenantsForUser(userId);
    const cookieTenantId = await readActiveTenantIdFromCookies();

    // 0 tenants
    if (tenantsForUser.length === 0) {
      const res = NextResponse.json({
        ok: true,
        activeTenantId: null,
        tenants: [],
        needsTenantSelection: true,
      });
      // if they had an old cookie from a previous account, clear it
      return clearTenantCookies(res);
    }

    // cookie present → validate it
    if (cookieTenantId) {
      const isValid = tenantsForUser.some((t) => t.tenantId === cookieTenantId);

      if (isValid) {
        return NextResponse.json({
          ok: true,
          activeTenantId: cookieTenantId,
          tenants: tenantsForUser,
          needsTenantSelection: false,
        });
      }

      // stale cookie → clear it, then continue selection rules
      const cleared = NextResponse.json({
        ok: true,
        activeTenantId: null,
        tenants: tenantsForUser,
        needsTenantSelection: tenantsForUser.length > 1,
        clearedStaleCookie: true,
      });
      clearTenantCookies(cleared);

      // if only one tenant, immediately set it
      if (tenantsForUser.length === 1) {
        cleared.headers.set("x-auto-selected-tenant", tenantsForUser[0].tenantId);
        return setTenantCookies(cleared, tenantsForUser[0].tenantId);
      }

      return cleared;
    }

    // no cookie:
    if (tenantsForUser.length === 1) {
      const res = NextResponse.json({
        ok: true,
        activeTenantId: tenantsForUser[0].tenantId,
        tenants: tenantsForUser,
        needsTenantSelection: false,
        autoSelected: true,
      });
      return setTenantCookies(res, tenantsForUser[0].tenantId);
    }

    // multiple tenants, no cookie
    return NextResponse.json({
      ok: true,
      activeTenantId: null,
      tenants: tenantsForUser,
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
 * POST:
 * - sets active tenant cookie (must belong to user for now)
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
      // also clear cookies here because the user is trying to select something invalid/stale
      const res = NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND_OR_NOT_OWNED" }, { status: 404 });
      return clearTenantCookies(res);
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