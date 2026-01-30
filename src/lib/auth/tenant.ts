// src/lib/auth/tenant.ts
import { auth } from "@clerk/nextjs/server";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
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

function normalizeRole(v: unknown): TenantRole | null {
  const r = String(v ?? "").trim();
  if (r === "owner" || r === "admin" || r === "member") return r;
  return null;
}

async function getMembershipRole(userId: string, tenantId: string): Promise<TenantRole | null> {
  // NOTE: We do not assume an "id" column exists on tenant_members.
  // We only rely on tenant_id, clerk_user_id, role, status.
  const r = await db.execute(sql`
    SELECT role
    FROM tenant_members
    WHERE tenant_id = ${tenantId}::uuid
      AND clerk_user_id = ${userId}
      AND (status IS NULL OR status = 'active')
    LIMIT 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  return normalizeRole(row?.role);
}

/**
 * requireTenantRole:
 * - Ensures user is authenticated
 * - Ensures app_user exists (mobility layer)
 * - Reads active tenant from cookie (shared cookie reader)
 * - Validates tenant membership via tenant_members (status active/null)
 * - Returns role (owner/admin/member)
 *
 * IMPORTANT: This function must NOT mutate cookies.
 * Only /api/tenant/context should set/clear tenant cookies.
 */
export async function requireTenantRole(allowed: TenantRole[]): Promise<TenantGate> {
  const { userId } = await auth();
  if (!userId) return deny(401, "UNAUTHENTICATED");

  await requireAppUserId();

  const tenantId = await readActiveTenantIdFromCookies();
  if (!tenantId) {
    return deny(400, "NO_ACTIVE_TENANT", "Select a tenant first.");
  }

  const role = await getMembershipRole(userId, tenantId);
  if (!role) {
    return deny(403, "FORBIDDEN", "No active tenant membership found for this user.");
  }

  if (!allowed.includes(role)) {
    return deny(403, "FORBIDDEN", `Role "${role}" is not allowed for this action.`);
  }

  return { ok: true, status: 200, tenantId, role };
}