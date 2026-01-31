// src/app/api/tenant/list/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requireAppUserId } from "@/lib/auth/requireAppUser";
import { readActiveTenantIdFromCookies } from "@/lib/tenant/activeTenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TenantRole = "owner" | "admin" | "member";

function normalizeRole(v: unknown): TenantRole {
  const r = String(v ?? "").trim().toLowerCase();
  if (r === "owner" || r === "admin" || r === "member") return r;
  return "member";
}

function rows(r: any): any[] {
  return (r as any)?.rows ?? (Array.isArray(r) ? r : []);
}

function json(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      pragma: "no-cache",
      expires: "0",
    },
  });
}

/**
 * Tenant list for signed-in user (RBAC).
 * - Does NOT auto-pick active tenant (that is /api/tenant/context responsibility).
 * - Returns role for each tenant.
 */
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return json({ ok: false, error: "UNAUTHENTICATED" }, 401);

    await requireAppUserId();

    const activeTenantId = await readActiveTenantIdFromCookies();

    const r = await db.execute(sql`
      SELECT
        t.id         AS tenant_id,
        t.slug       AS slug,
        t.name       AS name,
        m.role       AS role,
        t.created_at AS created_at
      FROM tenant_members m
      JOIN tenants t
        ON t.id = m.tenant_id
      WHERE m.clerk_user_id = ${userId}
        AND (m.status IS NULL OR m.status = 'active')
      ORDER BY t.created_at ASC
    `);

    const tenants = rows(r).map((x: any) => ({
      tenantId: String(x.tenant_id),
      slug: String(x.slug),
      name: x.name ? String(x.name) : null,
      role: normalizeRole(x.role),
    }));

    // IMPORTANT:
    // Do not return an invented activeTenantId. If cookie is missing, return null.
    // /api/tenant/context is the only endpoint that should auto-select + set cookies.
    const cookieValid = activeTenantId ? tenants.some((t) => t.tenantId === activeTenantId) : false;

    return json({
      ok: true,
      activeTenantId: cookieValid ? activeTenantId : null,
      tenants,
    });
  } catch (e: any) {
    return json({ ok: false, error: "INTERNAL", message: e?.message ?? String(e) }, 500);
  }
}