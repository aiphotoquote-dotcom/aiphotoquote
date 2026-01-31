// src/app/api/tenant/context/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requireAppUserId } from "@/lib/auth/requireAppUser";
import { readActiveTenantIdFromCookies, ACTIVE_TENANT_COOKIE_KEYS } from "@/lib/tenant/activeTenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tenantId: z.string().uuid().optional(),
  tenantSlug: z.string().min(3).optional(),
});

type TenantRole = "owner" | "admin" | "member";

function normalizeRole(v: unknown): TenantRole {
  const r = String(v ?? "").trim().toLowerCase();
  if (r === "owner" || r === "admin" || r === "member") return r;
  return "member";
}

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

function setTenantCookies(res: NextResponse, tenantId: string) {
  const opts = cookieOpts();
  res.cookies.set("activeTenantId", tenantId, opts);
  res.cookies.set("active_tenant_id", tenantId, opts);
  res.cookies.set("tenantId", tenantId, opts);
  res.cookies.set("tenant_id", tenantId, opts);
  return res;
}

function clearTenantCookies(res: NextResponse) {
  for (const name of ACTIVE_TENANT_COOKIE_KEYS) {
    res.cookies.delete({ name, path: "/" });
  }
  return res;
}

function rows(r: any): any[] {
  return (r as any)?.rows ?? (Array.isArray(r) ? r : []);
}

async function listTenantsForUser(userId: string) {
  const r = await db.execute(sql`
    SELECT
      t.id  AS tenant_id,
      t.slug AS slug,
      t.name AS name,
      m.role AS role,
      t.created_at AS created_at
    FROM tenant_members m
    JOIN tenants t
      ON t.id = m.tenant_id
    WHERE m.clerk_user_id = ${userId}
      AND (m.status IS NULL OR m.status = 'active')
    ORDER BY t.created_at ASC
  `);

  return rows(r).map((x: any) => ({
    tenantId: String(x.tenant_id),
    slug: String(x.slug),
    name: x.name ? String(x.name) : null,
    role: normalizeRole(x.role),
  }));
}

async function hasTenantAccessById(userId: string, tenantId: string) {
  const r = await db.execute(sql`
    SELECT 1
    FROM tenant_members
    WHERE tenant_id = ${tenantId}::uuid
      AND clerk_user_id = ${userId}
      AND (status IS NULL OR status = 'active')
    LIMIT 1
  `);
  return rows(r).length > 0;
}

async function resolveTenantBySlugForUser(userId: string, tenantSlug: string) {
  const r = await db.execute(sql`
    SELECT
      t.id AS tenant_id,
      t.slug AS slug,
      t.name AS name,
      m.role AS role
    FROM tenant_members m
    JOIN tenants t
      ON t.id = m.tenant_id
    WHERE m.clerk_user_id = ${userId}
      AND (m.status IS NULL OR m.status = 'active')
      AND t.slug = ${tenantSlug}
    LIMIT 1
  `);
  const row = rows(r)[0] ?? null;
  if (!row?.tenant_id) return null;

  return {
    tenantId: String(row.tenant_id),
    slug: String(row.slug),
    name: row.name ? String(row.name) : null,
    role: normalizeRole(row.role),
  };
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });

    await requireAppUserId();

    const tenantsForUser = await listTenantsForUser(userId);
    const cookieTenantId = await readActiveTenantIdFromCookies();

    if (tenantsForUser.length === 0) {
      const res = NextResponse.json({ ok: true, activeTenantId: null, tenants: [], needsTenantSelection: true });
      return clearTenantCookies(res);
    }

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

      const cleared = NextResponse.json({
        ok: true,
        activeTenantId: null,
        tenants: tenantsForUser,
        needsTenantSelection: tenantsForUser.length > 1,
        clearedStaleCookie: true,
      });
      clearTenantCookies(cleared);

      if (tenantsForUser.length === 1) {
        return setTenantCookies(cleared, tenantsForUser[0].tenantId);
      }

      return cleared;
    }

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

    return NextResponse.json({ ok: true, activeTenantId: null, tenants: tenantsForUser, needsTenantSelection: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "INTERNAL", message: e?.message ?? String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });

    await requireAppUserId();

    const bodyJson = await req.json().catch(() => null);
    const parsed = Body.safeParse(bodyJson);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "INVALID_BODY", issues: parsed.error.issues }, { status: 400 });
    }

    const { tenantId, tenantSlug } = parsed.data;
    if (!tenantId && !tenantSlug) {
      return NextResponse.json({ ok: false, error: "MISSING_TENANT_SELECTOR" }, { status: 400 });
    }

    let selected:
      | { tenantId: string; slug: string; name: string | null; role: TenantRole }
      | null = null;

    if (tenantId) {
      const ok = await hasTenantAccessById(userId, tenantId);
      if (!ok) {
        const res = NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND_OR_NOT_ACCESSIBLE" }, { status: 403 });
        return clearTenantCookies(res);
      }

      // fetch minimal tenant data for response consistency
      const r = await db.execute(sql`
        SELECT t.id AS tenant_id, t.slug AS slug, t.name AS name, m.role AS role
        FROM tenant_members m
        JOIN tenants t ON t.id = m.tenant_id
        WHERE m.clerk_user_id = ${userId}
          AND (m.status IS NULL OR m.status = 'active')
          AND t.id = ${tenantId}::uuid
        LIMIT 1
      `);
      const row = rows(r)[0] ?? null;
      selected = row?.tenant_id
        ? { tenantId: String(row.tenant_id), slug: String(row.slug), name: row.name ? String(row.name) : null, role: normalizeRole(row.role) }
        : null;
    } else if (tenantSlug) {
      selected = await resolveTenantBySlugForUser(userId, tenantSlug);
    }

    if (!selected) {
      const res = NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND_OR_NOT_ACCESSIBLE" }, { status: 404 });
      return clearTenantCookies(res);
    }

    const res = NextResponse.json({ ok: true, activeTenantId: selected.tenantId, tenant: selected });
    return setTenantCookies(res, selected.tenantId);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "INTERNAL", message: e?.message ?? String(e) }, { status: 500 });
  }
}