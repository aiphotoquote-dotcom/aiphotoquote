// src/lib/auth/tenant.ts
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { eq, and } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { requireAppUserId } from "@/lib/auth/requireAppUser";

export const runtime = "nodejs";

export type TenantRole = "owner" | "admin" | "member";

type GateOk = { ok: true; status: 200; tenantId: string; role: TenantRole };
type GateBad = { ok: false; status: number; error: string; message?: string };
export type TenantGate = GateOk | GateBad;

const COOKIE_KEYS = ["activeTenantId", "active_tenant_id", "tenantId", "tenant_id"] as const;

async function readActiveTenantIdFromCookies(): Promise<string | null> {
  const jar = await cookies();
  for (const k of COOKIE_KEYS) {
    const v = jar.get(k)?.value;
    if (v && String(v).trim()) return String(v).trim();
  }
  return null;
}

function deny(status: number, error: string, message?: string): GateBad {
  return { ok: false, status, error, ...(message ? { message } : {}) };
}

/**
 * requireTenantRole:
 * - Ensures user is authenticated
 * - Ensures app_user exists (mobility layer)
 * - Reads active tenant from cookie
 * - Validates tenant belongs to user (owner model for now)
 * - Returns role (owner/admin/member)
 *
 * IMPORTANT: This function must NOT mutate cookies.
 * Only /api/tenant/context should set/clear tenant cookies.
 */
export async function requireTenantRole(allowed: TenantRole[]): Promise<TenantGate> {
  const { userId } = await auth();
  if (!userId) return deny(401, "UNAUTHENTICATED");

  // Mobility layer (you already use this pattern)
  await requireAppUserId();

  const tenantId = await readActiveTenantIdFromCookies();
  if (!tenantId) {
    // Do NOT try to auto-pick here. The context endpoint is responsible for auto-select.
    return deny(400, "NO_ACTIVE_TENANT", "No active tenant selected.");
  }

  // For now: tenant must be owned by this user (matches /api/tenant/context logic)
  const owned = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId as any), eq(tenants.ownerClerkUserId, userId)))
    .limit(1)
    .then((r) => r[0]?.id ?? null);

  if (!owned) {
    // Tenant cookie exists but not valid for this user.
    // Do NOT clear cookies here; just deny.
    return deny(403, "TENANT_NOT_FOUND_OR_NOT_OWNED", "Active tenant is not accessible by this user.");
  }

  // Owner-only model for now
  const role: TenantRole = "owner";

  if (!allowed.includes(role)) {
    return deny(403, "FORBIDDEN", `Role "${role}" is not allowed for this action.`);
  }

  return { ok: true, status: 200, tenantId, role };
}