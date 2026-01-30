// src/lib/tenant/activeTenant.ts
import { cookies } from "next/headers";

export const ACTIVE_TENANT_COOKIE_KEYS = [
  "activeTenantId",
  "active_tenant_id",
  "tenantId",
  "tenant_id",
] as const;

/**
 * Reads the active tenant id from cookies.
 * Next.js 16 types cookies() as Promise<ReadonlyRequestCookies>, so we must await it.
 */
export async function readActiveTenantIdFromCookies(): Promise<string | null> {
  const jar = await cookies();

  for (const k of ACTIVE_TENANT_COOKIE_KEYS) {
    const v = jar.get(k)?.value;
    if (v) return v;
  }

  return null;
}