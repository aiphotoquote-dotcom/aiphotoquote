import { cookies } from "next/headers";

const KEYS = ["active_tenant_id", "activeTenantId", "tenant_id", "tenantId"] as const;

export function getActiveTenantIdFromCookies(): string | null {
  const jar = cookies();
  for (const k of KEYS) {
    const v = jar.get(k)?.value;
    if (v) return v;
  }
  return null;
}