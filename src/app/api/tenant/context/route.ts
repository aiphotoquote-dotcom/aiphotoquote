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

function setTenantCookies(res: NextResponse, tenantId: string) {
  const isProd = process.env.NODE_ENV === "production";

  const opts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProd,
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  };

  // keep back-compat names because other code checks multiple keys
  res.cookies.set("activeTenantId", tenantId, opts);
  res.cookies.set("active_tenant_id", tenantId, opts);
  res.cookies.set("tenantId", tenantId, opts);
  res.cookies.set("tenant_id", tenantId, opts);

  return res;
}

async function readActiveTenantIdFromCookies(): Promise<string | null> {
  // ✅ Next 16 typing: cookies() may be async depending on runtime/build
  const jar = await cookies();
  return (
    jar.get("activeTenantId")?.value ||
    jar.get("active_tenant_id")?.value ||
    jar.get("tenantId")?.value ||
    jar.get("tenant_id")?.value ||
    null
  );
}

/**
 * GET: returns tenant context for the signed-in user.
 *
 * Option B behavior:
 * - If user has 0 tenants: return ok:false? (we return ok:true + needsTenant=false + error code for UI)
 * - If user has exactly 1 tenant and cookie missing: auto-select that tenant (set cookie)
 * - If user has >1 tenants and cookie missing: DO NOT auto-select; UI must pick
 * - If cookie exists but doesn't match user's tenants: treat as not selected (UI must pick)
 */
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }

    // Ensure app_user exists (mobility layer)
    await requireAppUserId();

    const cookieTenantId = await readActiveTenantIdFromCookies();

    // For now: tenants owned by this Clerk user.
    // (Later: expand to tenant_members joined to app_users)
    const rows = await db
      .select({
        tenantId: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
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

    // 0 tenants → nothing to select
    if (tenantList.length === 0) {
      return NextResponse.json({
        ok: true,
        activeTenantId: null,
        tenants: [],
        needsTenantSelection: false,
        error: "NO_TENANTS",
        message: "No tenants found for this user.",
      });
    }

    // If cookie exists, ensure it belongs to this user
    const cookieMatches =
      !!cookieTenantId && tenantList.some((t) => t.tenantId === cookieTenantId);

    // If cookie is valid → use it
    if (cookieMatches) {
      return NextResponse.json({
        ok: true,
        activeTenantId: cookieTenantId,
        tenants: tenantList,
        needsTenantSelection: false,
      });
    }

    // If exactly 1 tenant and cookie missing/invalid → auto-select (Option B)
    if (tenantList.length === 1) {
      const only = tenantList[0];
      const res = NextResponse.json({
        ok: true,
        activeTenantId: only.tenantId,
        tenants: tenantList,
        needsTenantSelection: false,
        autoSelected: true,
      });
      return setTenantCookies(res, only.tenantId);
    }

    // If multiple tenants and no valid cookie → require explicit selection
    return NextResponse.json({
      ok: true,
      activeTenantId: null,
      tenants: tenantList,
      needsTenantSelection: true,
      error: "TENANT_NOT_SELECTED",
      message: "Multiple tenants available. Please select an active tenant.",
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

    // Ensure app_user exists (mobility layer)
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

    // For now: user must OWN the tenant
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