// src/lib/auth/tenant.ts
import { auth } from "@clerk/nextjs/server";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requireAppUserId } from "@/lib/auth/requireAppUser";
import { readActiveTenantIdFromCookies } from "@/lib/tenant/activeTenant";
import { getActorContext } from "@/lib/rbac/actor";
import { hasPlatformRole } from "@/lib/rbac/guards";
import { readTenantImpersonationFromCookies } from "@/lib/platform/tenantImpersonation";

export const runtime = "nodejs";

export type TenantRole = "owner" | "admin" | "member";

type GateOk = {
  ok: true;
  status: 200;
  tenantId: string;
  role: TenantRole;
  impersonating?: boolean;
  impersonationActorClerkUserId?: string;
  impersonationActorEmail?: string | null;
};

type GateBad = { ok: false; status: number; error: string; message?: string };
export type TenantGate = GateOk | GateBad;

function deny(status: number, error: string, message?: string): GateBad {
  return { ok: false, status, error, ...(message ? { message } : {}) };
}

function normalizeRole(v: unknown): TenantRole | null {
  const r = String(v ?? "").trim().toLowerCase();
  if (r === "owner" || r === "admin" || r === "member") return r;
  return null;
}

async function getMembershipRole(userId: string, tenantId: string): Promise<TenantRole | null> {
  const r = await db.execute(sql`
    SELECT role
    FROM tenant_members
    WHERE tenant_id = ${tenantId}::uuid
      AND clerk_user_id = ${userId}
      AND (status IS NULL OR status = 'active')
    LIMIT 1
  `);

  const row: any =
    (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

  return normalizeRole(row?.role);
}

async function getLegacyOwnerRole(userId: string, tenantId: string): Promise<TenantRole | null> {
  const r = await db.execute(sql`
    SELECT 1
    FROM tenants
    WHERE id = ${tenantId}::uuid
      AND owner_clerk_user_id = ${userId}
      AND COALESCE(status, 'active') = 'active'
    LIMIT 1
  `);

  const row: any =
    (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

  return row ? "owner" : null;
}

async function getImpersonationRoleForCurrentActor(
  tenantId: string
): Promise<{
  allowed: boolean;
  role: TenantRole | null;
  actorClerkUserId?: string;
  actorEmail?: string | null;
} | null> {
  try {
    const actor = await getActorContext();

    if (!hasPlatformRole(actor, ["platform_owner", "platform_admin", "platform_support"])) {
      return null;
    }

    const imp = await readTenantImpersonationFromCookies();
    if (!imp) return null;

    if (imp.actorClerkUserId !== actor.clerkUserId) {
      return null;
    }

    if (imp.tenantId !== tenantId) {
      return null;
    }

    return {
      allowed: true,
      role: "owner",
      actorClerkUserId: actor.clerkUserId,
      actorEmail: actor.email ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * requireTenantRole:
 * - Ensures user is authenticated
 * - Ensures app_user exists
 * - Reads active tenant from cookie
 * - Validates tenant access by:
 *   1) normal tenant_members membership
 *   2) legacy tenants.owner_clerk_user_id fallback
 *   3) PCC impersonation session for platform actors
 *
 * IMPORTANT:
 * - This function does NOT mutate cookies.
 * - Only tenant context / impersonation routes should set or clear cookies.
 */
export async function requireTenantRole(allowed: TenantRole[]): Promise<TenantGate> {
  const { userId } = await auth();
  if (!userId) return deny(401, "UNAUTHENTICATED");

  await requireAppUserId();

  const tenantId = await readActiveTenantIdFromCookies();
  if (!tenantId) {
    return deny(400, "NO_ACTIVE_TENANT", "Select a tenant first.");
  }

  const membershipRole = await getMembershipRole(userId, tenantId);
  if (membershipRole) {
    if (!allowed.includes(membershipRole)) {
      return deny(403, "FORBIDDEN", `Role "${membershipRole}" is not allowed for this action.`);
    }

    return { ok: true, status: 200, tenantId, role: membershipRole };
  }

  const legacyOwnerRole = await getLegacyOwnerRole(userId, tenantId);
  if (legacyOwnerRole) {
    if (!allowed.includes(legacyOwnerRole)) {
      return deny(403, "FORBIDDEN", `Role "${legacyOwnerRole}" is not allowed for this action.`);
    }

    return { ok: true, status: 200, tenantId, role: legacyOwnerRole };
  }

  const impersonation = await getImpersonationRoleForCurrentActor(tenantId);
  if (impersonation?.allowed && impersonation.role) {
    if (!allowed.includes(impersonation.role)) {
      return deny(403, "FORBIDDEN", `Role "${impersonation.role}" is not allowed for this action.`);
    }

    return {
      ok: true,
      status: 200,
      tenantId,
      role: impersonation.role,
      impersonating: true,
      impersonationActorClerkUserId: impersonation.actorClerkUserId,
      impersonationActorEmail: impersonation.actorEmail ?? null,
    };
  }

  return deny(403, "FORBIDDEN", "No active tenant membership found for this user.");
}