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
    const raw = jar.get(k)?.value;
    const v = typeof raw === "string" ? raw.trim() : "";
    if (v) return v;
  }

  return null;
}