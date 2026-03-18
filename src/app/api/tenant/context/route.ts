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
import { getActorContext } from "@/lib/rbac/actor";
import { hasPlatformRole } from "@/lib/rbac/guards";
import { readTenantImpersonationFromCookies } from "@/lib/platform/tenantImpersonation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tenantId: z.string().uuid().optional(),
  tenantSlug: z.string().min(3).optional(),
});

type TenantRole = "owner" | "admin" | "member";
type BrandLogoVariant = "auto" | "light" | "dark";

function normalizeRole(v: unknown): TenantRole {
  const r = String(v ?? "").trim().toLowerCase();
  if (r === "owner" || r === "admin" || r === "member") return r;
  return "member";
}

function normalizeLogoVariant(v: unknown): BrandLogoVariant {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "light" || s === "dark") return s;
  return "auto";
}

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
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
    WITH member_rows AS (
      SELECT
        t.id AS tenant_id,
        t.slug AS slug,
        t.name AS name,
        m.role AS role,
        t.created_at AS created_at,
        ts.brand_logo_url AS brand_logo_url,
        ts.brand_logo_variant AS brand_logo_variant
      FROM tenant_members m
      JOIN tenants t
        ON t.id = m.tenant_id
      LEFT JOIN tenant_settings ts
        ON ts.tenant_id = t.id
      WHERE m.clerk_user_id = ${userId}
        AND (m.status IS NULL OR m.status = 'active')
        AND COALESCE(t.status, 'active') = 'active'
    ),
    legacy_owner_rows AS (
      SELECT
        t.id AS tenant_id,
        t.slug AS slug,
        t.name AS name,
        'owner'::text AS role,
        t.created_at AS created_at,
        ts.brand_logo_url AS brand_logo_url,
        ts.brand_logo_variant AS brand_logo_variant
      FROM tenants t
      LEFT JOIN tenant_settings ts
        ON ts.tenant_id = t.id
      WHERE t.owner_clerk_user_id = ${userId}
        AND COALESCE(t.status, 'active') = 'active'
    ),
    combined AS (
      SELECT * FROM member_rows
      UNION ALL
      SELECT * FROM legacy_owner_rows
    ),
    ranked AS (
      SELECT
        tenant_id,
        slug,
        name,
        role,
        created_at,
        brand_logo_url,
        brand_logo_variant,
        ROW_NUMBER() OVER (
          PARTITION BY tenant_id
          ORDER BY
            CASE lower(role)
              WHEN 'owner' THEN 1
              WHEN 'admin' THEN 2
              ELSE 3
            END,
            created_at ASC
        ) AS rn
      FROM combined
    )
    SELECT
      tenant_id,
      slug,
      name,
      role,
      created_at,
      brand_logo_url,
      brand_logo_variant
    FROM ranked
    WHERE rn = 1
    ORDER BY created_at ASC
  `);

  return rows(r).map((x: any) => ({
    tenantId: String(x.tenant_id),
    slug: String(x.slug),
    name: x.name ? String(x.name) : null,
    role: normalizeRole(x.role),
    brandLogoUrl: safeTrim(x.brand_logo_url) || null,
    brandLogoVariant: normalizeLogoVariant(x.brand_logo_variant),
  }));
}

async function hasTenantAccessById(userId: string, tenantId: string) {
  const r = await db.execute(sql`
    SELECT 1
    FROM tenants t
    LEFT JOIN tenant_members m
      ON m.tenant_id = t.id
      AND m.clerk_user_id = ${userId}
      AND (m.status IS NULL OR m.status = 'active')
    WHERE t.id = ${tenantId}::uuid
      AND COALESCE(t.status, 'active') = 'active'
      AND (
        m.tenant_id IS NOT NULL
        OR t.owner_clerk_user_id = ${userId}
      )
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
      COALESCE(m.role, CASE WHEN t.owner_clerk_user_id = ${userId} THEN 'owner' END, 'member') AS role,
      ts.brand_logo_url AS brand_logo_url,
      ts.brand_logo_variant AS brand_logo_variant
    FROM tenants t
    LEFT JOIN tenant_members m
      ON m.tenant_id = t.id
      AND m.clerk_user_id = ${userId}
      AND (m.status IS NULL OR m.status = 'active')
    LEFT JOIN tenant_settings ts
      ON ts.tenant_id = t.id
    WHERE t.slug = ${tenantSlug}
      AND COALESCE(t.status, 'active') = 'active'
      AND (
        m.tenant_id IS NOT NULL
        OR t.owner_clerk_user_id = ${userId}
      )
    LIMIT 1
  `);

  const row = rows(r)[0] ?? null;
  if (!row?.tenant_id) return null;

  return {
    tenantId: String(row.tenant_id),
    slug: String(row.slug),
    name: row.name ? String(row.name) : null,
    role: normalizeRole(row.role),
    brandLogoUrl: safeTrim(row.brand_logo_url) || null,
    brandLogoVariant: normalizeLogoVariant(row.brand_logo_variant),
  };
}

async function fetchTenantByIdForUser(userId: string, tenantId: string) {
  const r = await db.execute(sql`
    SELECT
      t.id AS tenant_id,
      t.slug AS slug,
      t.name AS name,
      COALESCE(m.role, CASE WHEN t.owner_clerk_user_id = ${userId} THEN 'owner' END, 'member') AS role,
      ts.brand_logo_url AS brand_logo_url,
      ts.brand_logo_variant AS brand_logo_variant
    FROM tenants t
    LEFT JOIN tenant_members m
      ON m.tenant_id = t.id
      AND m.clerk_user_id = ${userId}
      AND (m.status IS NULL OR m.status = 'active')
    LEFT JOIN tenant_settings ts
      ON ts.tenant_id = t.id
    WHERE t.id = ${tenantId}::uuid
      AND COALESCE(t.status, 'active') = 'active'
      AND (
        m.tenant_id IS NOT NULL
        OR t.owner_clerk_user_id = ${userId}
      )
    LIMIT 1
  `);

  const row = rows(r)[0] ?? null;
  if (!row?.tenant_id) return null;

  return {
    tenantId: String(row.tenant_id),
    slug: String(row.slug),
    name: row.name ? String(row.name) : null,
    role: normalizeRole(row.role),
    brandLogoUrl: safeTrim(row.brand_logo_url) || null,
    brandLogoVariant: normalizeLogoVariant(row.brand_logo_variant),
  };
}

async function fetchTenantByIdAny(tenantId: string) {
  const r = await db.execute(sql`
    SELECT
      t.id AS tenant_id,
      t.slug AS slug,
      t.name AS name,
      ts.brand_logo_url AS brand_logo_url,
      ts.brand_logo_variant AS brand_logo_variant
    FROM tenants t
    LEFT JOIN tenant_settings ts
      ON ts.tenant_id = t.id
    WHERE t.id = ${tenantId}::uuid
      AND COALESCE(t.status, 'active') = 'active'
    LIMIT 1
  `);

  const row = rows(r)[0] ?? null;
  if (!row?.tenant_id) return null;

  return {
    tenantId: String(row.tenant_id),
    slug: String(row.slug),
    name: row.name ? String(row.name) : null,
    role: "owner" as TenantRole,
    brandLogoUrl: safeTrim(row.brand_logo_url) || null,
    brandLogoVariant: normalizeLogoVariant(row.brand_logo_variant),
  };
}

async function getActiveImpersonationForCurrentActor() {
  try {
    const actor = await getActorContext();
    if (!hasPlatformRole(actor, ["platform_owner", "platform_admin", "platform_support"])) {
      return null;
    }

    const imp = await readTenantImpersonationFromCookies();
    if (!imp) return null;
    if (imp.actorClerkUserId !== actor.clerkUserId) return null;

    const tenant = await fetchTenantByIdAny(imp.tenantId);
    if (!tenant) return null;

    return {
      impersonation: imp,
      tenant,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return noStore(NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 }));
    }

    await requireAppUserId();

    const activeImpersonation = await getActiveImpersonationForCurrentActor();
    if (activeImpersonation) {
      return noStore(
        NextResponse.json({
          ok: true,
          activeTenantId: activeImpersonation.tenant.tenantId,
          tenants: [activeImpersonation.tenant],
          needsTenantSelection: false,
          impersonation: {
            active: true,
            tenantId: activeImpersonation.tenant.tenantId,
            tenantSlug: activeImpersonation.tenant.slug,
            tenantName: activeImpersonation.tenant.name,
            startedAt: activeImpersonation.impersonation.startedAt,
          },
        })
      );
    }

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
    if (!userId) {
      return noStore(NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 }));
    }

    await requireAppUserId();

    const activeImpersonation = await getActiveImpersonationForCurrentActor();
    if (activeImpersonation) {
      return noStore(
        NextResponse.json(
          {
            ok: false,
            error: "IMPERSONATION_ACTIVE",
            message: "Exit impersonation before switching tenants.",
          },
          { status: 409 }
        )
      );
    }

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

    let selected:
      | {
          tenantId: string;
          slug: string;
          name: string | null;
          role: TenantRole;
          brandLogoUrl: string | null;
          brandLogoVariant: BrandLogoVariant;
        }
      | null = null;

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