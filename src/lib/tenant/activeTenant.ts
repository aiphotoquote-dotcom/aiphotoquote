// src/lib/tenant/activeTenant.ts
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

/**
 * Canonical cookie key (new).
 * We read legacy keys for backwards compatibility, but we only WRITE the canonical key going forward.
 */
export const ACTIVE_TENANT_COOKIE = "apq_tenant" as const;

export const ACTIVE_TENANT_LEGACY_KEYS = [
  "activeTenantId",
  "active_tenant_id",
  "tenantId",
  "tenant_id",
] as const;

export const ACTIVE_TENANT_COOKIE_KEYS = [ACTIVE_TENANT_COOKIE, ...ACTIVE_TENANT_LEGACY_KEYS] as const;

function cookieOpts() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProd,
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  };
}

/**
 * Reads the active tenant id from cookies.
 * Next.js 16 types cookies() as Promise<ReadonlyRequestCookies>, so we must await it.
 */
export async function readActiveTenantIdFromCookies(): Promise<string | null> {
  const jar = await cookies();

  for (const k of ACTIVE_TENANT_COOKIE_KEYS) {
    const v = jar.get(k)?.value;
    if (v && String(v).trim()) return String(v).trim();
  }

  return null;
}

/**
 * Writes ONLY the canonical cookie key (apq_tenant),
 * and aggressively clears legacy keys to prevent “wrong tenant” bugs.
 */
export function setActiveTenantCookie(res: NextResponse, tenantId: string): NextResponse {
  const path = "/";

  // Clear legacy keys (and canonical) first to remove collisions
  res.cookies.delete({ name: ACTIVE_TENANT_COOKIE, path });
  for (const k of ACTIVE_TENANT_LEGACY_KEYS) {
    res.cookies.delete({ name: k, path });
  }

  // Write canonical only
  res.cookies.set(ACTIVE_TENANT_COOKIE, tenantId, cookieOpts());
  return res;
}

/**
 * Clears canonical + legacy keys.
 */
export function clearActiveTenantCookies(res: NextResponse): NextResponse {
  const path = "/";

  res.cookies.delete({ name: ACTIVE_TENANT_COOKIE, path });
  for (const k of ACTIVE_TENANT_LEGACY_KEYS) {
    res.cookies.delete({ name: k, path });
  }

  return res;
}