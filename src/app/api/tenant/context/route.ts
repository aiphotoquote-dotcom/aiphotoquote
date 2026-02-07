// src/app/api/tenant/context/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
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

type TenantRole = "owner" | "admin" | "member";

function normalizeRole(v: unknown): TenantRole {
  const r = String(v ?? "").trim().toLowerCase();
  if (r === "owner" || r === "admin" || r === "member") return r;
  return "member";
}

function rows(r: any): any[] {
  return (r as any)?.rows ?? (Array.isArray(r) ? r : []);
}

function noStore(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
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

async function fetchTenantByIdForUser(userId: string, tenantId: string) {
  const r = await db.execute(sql`
    SELECT
      t.id AS tenant_id,
      t.slug AS slug,
      t.name AS name,
      m.role AS role
    FROM tenant_members m
    JOIN tenants t ON t.id = m.tenant_id
    WHERE m.clerk_user_id = ${userId}
      AND (m.status IS NULL OR m.status = 'active')
      AND t.id = ${tenantId}::uuid
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
    if (!userId) return noStore(NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 }));

    await requireAppUserId();

    const tenantsForUser = await listTenantsForUser(userId);
    const cookieTenantId = await readActiveTenantIdFromCookies();

    if (tenantsForUser.length === 0) {
      const res = NextResponse.json({
        ok: true,
        activeTenantId: null,
        tenants: [],
        needsTenantSelection: true,
      });
      return noStore(clearActiveTenantCookies(res));
    }

    if (cookieTenantId) {
      const isValid = tenantsForUser.some((t) => t.tenantId === cookieTenantId);

      if (isValid) {
        return noStore(
          NextResponse.json({
            ok: true,
            activeTenantId: cookieTenantId,
            tenants: tenantsForUser,
            needsTenantSelection: false,
          })
        );
      }

      // stale cookie
      const cleared = NextResponse.json({
        ok: true,
        activeTenantId: null,
        tenants: tenantsForUser,
        needsTenantSelection: tenantsForUser.length > 1,
        clearedStaleCookie: true,
      });

      const clearedRes = clearActiveTenantCookies(cleared);

      if (tenantsForUser.length === 1) {
        return noStore(setActiveTenantCookie(clearedRes, tenantsForUser[0].tenantId));
      }

      return noStore(clearedRes);
    }

    // no cookie
    if (tenantsForUser.length === 1) {
      const res = NextResponse.json({
        ok: true,
        activeTenantId: tenantsForUser[0].tenantId,
        tenants: tenantsForUser,
        needsTenantSelection: false,
        autoSelected: true,
      });
      return noStore(setActiveTenantCookie(res, tenantsForUser[0].tenantId));
    }

    return noStore(
      NextResponse.json({
        ok: true,
        activeTenantId: null,
        tenants: tenantsForUser,
        needsTenantSelection: true,
      })
    );
  } catch (e: any) {
    return noStore(
      NextResponse.json({ ok: false, error: "INTERNAL", message: e?.message ?? String(e) }, { status: 500 })
    );
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return noStore(NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 }));

    await requireAppUserId();

    const bodyJson = await req.json().catch(() => null);
    const parsed = Body.safeParse(bodyJson);
    if (!parsed.success) {
      return noStore(
        NextResponse.json({ ok: false, error: "INVALID_BODY", issues: parsed.error.issues }, { status: 400 })
      );
    }

    const { tenantId, tenantSlug } = parsed.data;
    if (!tenantId && !tenantSlug) {
      return noStore(NextResponse.json({ ok: false, error: "MISSING_TENANT_SELECTOR" }, { status: 400 }));
    }

    let selected: { tenantId: string; slug: string; name: string | null; role: TenantRole } | null = null;

    if (tenantId) {
      const ok = await hasTenantAccessById(userId, tenantId);
      if (!ok) {
        const res = NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND_OR_NOT_ACCESSIBLE" }, { status: 403 });
        return noStore(clearActiveTenantCookies(res));
      }
      selected = await fetchTenantByIdForUser(userId, tenantId);
    } else if (tenantSlug) {
      selected = await resolveTenantBySlugForUser(userId, tenantSlug);
    }

    if (!selected) {
      const res = NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND_OR_NOT_ACCESSIBLE" }, { status: 404 });
      return noStore(clearActiveTenantCookies(res));
    }

    const res = NextResponse.json({ ok: true, activeTenantId: selected.tenantId, tenant: selected });
    return noStore(setActiveTenantCookie(res, selected.tenantId));
  } catch (e: any) {
    return noStore(
      NextResponse.json({ ok: false, error: "INTERNAL", message: e?.message ?? String(e) }, { status: 500 })
    );
  }
}