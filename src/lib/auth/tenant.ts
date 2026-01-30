// src/lib/auth/tenant.ts
import { auth } from "@clerk/nextjs/server";
import { eq, and } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { requireAppUserId } from "@/lib/auth/requireAppUser";
import { readActiveTenantIdFromCookies } from "@/lib/tenant/activeTenant";

export const runtime = "nodejs";

export type TenantRole = "owner" | "admin" | "member";

type GateOk = { ok: true; status: 200; tenantId: string; role: TenantRole };
type GateBad = { ok: false; status: number; error: string; message?: string };
export type TenantGate = GateOk | GateBad;

function deny(status: number, error: string, message?: string): GateBad {
  return { ok: false, status, error, ...(message ? { message } : {}) };
}

/**
 * requireTenantRole:
 * - Ensures Clerk auth
 * - Ensures app_user exists (mobility layer)
 * - Reads active tenant from cookie (single canonical reader)
 * - Validates tenant belongs to user (owner-only model for now)
 * - Returns role
 *
 * IMPORTANT: Must NOT mutate cookies. Only /api/tenant/context writes cookies.
 *
 * RBAC note:
 * - Today: owner-only (tenants.ownerClerkUserId)
 * - Later: swap validation to tenant_members (user can have owner/admin/member per tenant)
 */
export async function requireTenantRole(allowed: TenantRole[]): Promise<TenantGate> {
  const { userId } = await auth();
  if (!userId) return deny(401, "UNAUTHENTICATED");

  // Mobility layer (you already use this pattern)
  await requireAppUserId();

  const tenantId = await readActiveTenantIdFromCookies();
  if (!tenantId) {
    // do not auto-select here; context endpoint owns selection + cookie set
    return deny(400, "NO_ACTIVE_TENANT", "Select a tenant first.");
  }

  // Owner-only model for now: tenant must be owned by this Clerk user
  const owned = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId as any), eq(tenants.ownerClerkUserId, userId)))
    .limit(1)
    .then((r) => r[0]?.id ?? null);

  if (!owned) {
    // Cookie exists but tenant isn't accessible by this user (stale or wrong account)
    // DO NOT clear cookies here.
    return deny(403, "TENANT_NOT_FOUND_OR_NOT_OWNED", "Active tenant is not accessible by this user.");
  }

  // Owner-only role until tenant_members is implemented
  const role: TenantRole = "owner";

  if (!allowed.includes(role)) {
    return deny(403, "FORBIDDEN", `Role "${role}" is not allowed for this action.`);
  }

  return { ok: true, status: 200, tenantId, role };
}