// src/app/api/tenant/context/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { requireAppUserId } from "@/lib/auth/requireAppUser";
import {
  readActiveTenantIdFromCookies,
  setActiveTenantCookie,
  clearActiveTenantCookies,
} from "@/lib/tenant/activeTenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tenantId: z.string().uuid().optional(),
  tenantSlug: z.string().min(3).optional(),
});

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

/**
 * GET: returns tenant context for the signed-in user.
 * - Reads active tenant from cookies (canonical + legacy)
 * - Validates cookie tenant is in the returned list
 * - Auto-selects when exactly 1 tenant exists (sets canonical cookie)
 */
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return json({ ok: false, error: "UNAUTHENTICATED" }, 401);

    // Mobility layer
    await requireAppUserId();

    const cookieTenantId = await readActiveTenantIdFromCookies();

    // Owner-only model for now (RBAC later via tenant_members)
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

    // If cookie exists, validate it belongs to this user’s tenant list
    if (cookieTenantId) {
      const isValid = tenantList.some((t) => t.tenantId === cookieTenantId);
      if (isValid) {
        return json({
          ok: true,
          activeTenantId: cookieTenantId,
          tenants: tenantList,
          needsTenantSelection: false,
        });
      }

      // Stale/bad cookie: clear canonical + legacy keys
      const res = json({
        ok: true,
        activeTenantId: null,
        tenants: tenantList,
        needsTenantSelection: tenantList.length !== 1,
        clearedStaleCookie: true,
      });

      clearActiveTenantCookies(res);

      // If exactly 1 tenant exists, set the correct one right away
      if (tenantList.length === 1) {
        setActiveTenantCookie(res, tenantList[0].tenantId);
        // reflect the new active tenant in response
        (res as any)._body = undefined; // no-op safeguard; NextResponse ignores
        return res;
      }

      return res;
    }

    // No cookie:
    if (tenantList.length === 0) {
      return json({
        ok: true,
        activeTenantId: null,
        tenants: [],
        needsTenantSelection: true,
      });
    }

    if (tenantList.length === 1) {
      const res = json({
        ok: true,
        activeTenantId: tenantList[0].tenantId,
        tenants: tenantList,
        needsTenantSelection: false,
        autoSelected: true,
      });

      return setActiveTenantCookie(res, tenantList[0].tenantId);
    }

    return json({
      ok: true,
      activeTenantId: null,
      tenants: tenantList,
      needsTenantSelection: true,
    });
  } catch (e: any) {
    return json({ ok: false, error: "INTERNAL", message: e?.message ?? String(e) }, 500);
  }
}

/**
 * POST: sets active tenant cookie (must be owned by this user for now)
 * - Writes ONLY canonical cookie key (apq_tenant)
 */
export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return json({ ok: false, error: "UNAUTHENTICATED" }, 401);

    await requireAppUserId();

    const body = await req.json().catch(() => null);
    const parsed = Body.safeParse(body);
    if (!parsed.success) {
      return json({ ok: false, error: "INVALID_BODY", issues: parsed.error.issues }, 400);
    }

    const { tenantId, tenantSlug } = parsed.data;
    if (!tenantId && !tenantSlug) {
      return json({ ok: false, error: "MISSING_TENANT_SELECTOR" }, 400);
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
      return json({ ok: false, error: "TENANT_NOT_FOUND_OR_NOT_OWNED" }, 404);
    }

    const res = json({ ok: true, activeTenantId: t.id, tenant: t });
    return setActiveTenantCookie(res, t.id);
  } catch (e: any) {
    return json({ ok: false, error: "INTERNAL", message: e?.message ?? String(e) }, 500);
  }
}