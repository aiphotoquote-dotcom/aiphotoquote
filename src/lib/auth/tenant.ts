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
    const raw = jar.get(k)?.value;
    const v = typeof raw === "string" ? raw.trim() : "";
    if (v) return v;
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
 * - Reads active tenant from cookie (if present)
 * - Validates tenant belongs to user (owner model for now)
 * - If cookie is missing/stale AND user has exactly 1 tenant, falls back to that tenant (WITHOUT mutating cookies)
 *
 * IMPORTANT: This function must NOT mutate cookies.
 * Only /api/tenant/context should set/clear tenant cookies.
 */
export async function requireTenantRole(allowed: TenantRole[]): Promise<TenantGate> {
  const { userId } = await auth();
  if (!userId) return deny(401, "UNAUTHENTICATED");

  // Mobility layer (you already use this pattern)
  await requireAppUserId();

  const cookieTenantId = await readActiveTenantIdFromCookies();

  // Load owned tenants (owner-only model for now, same as /api/tenant/context)
  const ownedTenants = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.ownerClerkUserId, userId));

  if (ownedTenants.length === 0) {
    return deny(403, "NO_TENANTS", "No tenants found for this user.");
  }

  // Helper: if user has exactly one tenant, use it as a safe fallback without cookies
  const singleOwnedTenantId = ownedTenants.length === 1 ? ownedTenants[0]!.id : null;

  // If we have a cookie tenant id, validate it is owned by user
  if (cookieTenantId) {
    const owned = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.id, cookieTenantId), eq(tenants.ownerClerkUserId, userId)))
      .limit(1)
      .then((r) => r[0]?.id ?? null);

    if (owned) {
      const role: TenantRole = "owner";
      if (!allowed.includes(role)) return deny(403, "FORBIDDEN", `Role "${role}" is not allowed for this action.`);
      return { ok: true, status: 200, tenantId: owned, role };
    }

    // Cookie exists but is stale/invalid for this user.
    // Do NOT clear cookies here; just fall back if we can.
    if (singleOwnedTenantId) {
      const role: TenantRole = "owner";
      if (!allowed.includes(role)) return deny(403, "FORBIDDEN", `Role "${role}" is not allowed for this action.`);
      return { ok: true, status: 200, tenantId: singleOwnedTenantId, role };
    }

    return deny(403, "TENANT_NOT_FOUND_OR_NOT_OWNED", "Active tenant is not accessible by this user.");
  }

  // No cookie tenant id:
  // If user only has one tenant, use it (without mutating cookies)
  if (singleOwnedTenantId) {
    const role: TenantRole = "owner";
    if (!allowed.includes(role)) return deny(403, "FORBIDDEN", `Role "${role}" is not allowed for this action.`);
    return { ok: true, status: 200, tenantId: singleOwnedTenantId, role };
  }

  // Multiple tenants + no cookie => must select via /api/tenant/context
  return deny(400, "NO_ACTIVE_TENANT", "No active tenant selected. Use the tenant switcher.");
}