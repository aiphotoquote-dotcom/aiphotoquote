import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export type TenantRole = "owner" | "admin" | "member";

export const ACTIVE_TENANT_COOKIE = "apq_tenant";

/**
 * Reads active tenant from cookie.
 * This is the *single source* for which tenant is currently being administered.
 */
export async function getActiveTenantId(): Promise<string | null> {
  const c = await cookies();
  const v = c.get(ACTIVE_TENANT_COOKIE)?.value?.trim();
  return v || null;
}

/**
 * List tenants for current user based on tenant_members.
 * Also returns role.
 */
export async function listUserTenants(): Promise<
  Array<{ tenantId: string; slug: string; name: string | null; role: TenantRole }>
> {
  const { userId } = await auth();
  if (!userId) return [];

  const r = await db.execute(sql`
    select
      t.id as "tenantId",
      t.slug as "slug",
      t.name as "name",
      tm.role as "role"
    from tenant_members tm
    join tenants t on t.id = tm.tenant_id
    where tm.clerk_user_id = ${userId}
      and tm.status = 'active'
    order by t.created_at desc
  `);

  const rows: any[] =
    (r as any)?.rows ?? (Array.isArray(r) ? (r as any) : []);

  return rows.map((x) => ({
    tenantId: String(x.tenantId),
    slug: String(x.slug),
    name: x.name == null ? null : String(x.name),
    role: x.role as TenantRole,
  }));
}

/**
 * Validates that the current user is a member of the active tenant
 * and has one of the allowed roles.
 *
 * Returns tenantId + role.
 */
export async function requireTenantRole(allowed: TenantRole[]) {
  const { userId } = await auth();
  if (!userId) {
    return { ok: false as const, status: 401 as const, error: "UNAUTHENTICATED" };
  }

  const tenantId = await getActiveTenantId();
  if (!tenantId) {
    return { ok: false as const, status: 400 as const, error: "NO_ACTIVE_TENANT" };
  }

  const r = await db.execute(sql`
    select role, status
    from tenant_members
    where tenant_id = ${tenantId}::uuid
      and clerk_user_id = ${userId}
    limit 1
  `);

  const row: any =
    (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

  if (!row || row.status !== "active") {
    return { ok: false as const, status: 403 as const, error: "NOT_A_MEMBER" };
  }

  const role = row.role as TenantRole;
  if (!allowed.includes(role)) {
    return { ok: false as const, status: 403 as const, error: "INSUFFICIENT_ROLE", role };
  }

  return { ok: true as const, tenantId, role };
}

/**
 * Bootstraps membership: if user owns a tenant (legacy model),
 * ensure tenant_members has an owner row for them.
 *
 * This keeps your system compatible if some tenants were created before tenant_members existed.
 */
export async function ensureOwnerMembershipForLegacyTenants() {
  const { userId } = await auth();
  if (!userId) return;

  // Find tenants where user is owner but not in tenant_members yet
  await db.execute(sql`
    insert into tenant_members (tenant_id, clerk_user_id, role, status)
    select t.id, ${userId}, 'owner', 'active'
    from tenants t
    where t.owner_clerk_user_id = ${userId}
      and not exists (
        select 1
        from tenant_members tm
        where tm.tenant_id = t.id
          and tm.clerk_user_id = ${userId}
      )
  `);
}
