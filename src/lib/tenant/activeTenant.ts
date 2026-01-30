// src/lib/tenant/activeTenant.ts
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

/**
 * Canonical active-tenant cookie name for the whole platform.
 * This is the ONLY cookie key we should write going forward.
 */
export const ACTIVE_TENANT_COOKIE = "apq_tenant" as const;

/**
 * Legacy keys we previously wrote. We'll keep reading them for a while
 * to avoid breaking existing users, but we will STOP writing them.
 */
export const LEGACY_ACTIVE_TENANT_COOKIE_KEYS = [
  "activeTenantId",
  "active_tenant_id",
  "tenantId",
  "tenant_id",
] as const;

export const ALL_ACTIVE_TENANT_COOKIE_KEYS = [
  ACTIVE_TENANT_COOKIE,
  ...LEGACY_ACTIVE_TENANT_COOKIE_KEYS,
] as const;

function cookieOptions() {
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
 * Read active tenant from cookies (canonical first, then legacy).
 * Next.js 16 types cookies() as Promise<ReadonlyRequestCookies> -> must await.
 */
export async function readActiveTenantIdFromCookies(): Promise<string | null> {
  const jar = await cookies();

  for (const k of ALL_ACTIVE_TENANT_COOKIE_KEYS) {
    const v = jar.get(k)?.value;
    if (v && String(v).trim()) return String(v).trim();
  }

  return null;
}

/**
 * Write the canonical cookie to the response.
 * NOTE: We do NOT write legacy keys anymore.
 */
export function setActiveTenantCookie(res: NextResponse, tenantId: string) {
  res.cookies.set(ACTIVE_TENANT_COOKIE, tenantId, cookieOptions());
  return res;
}

/**
 * Clear canonical + legacy keys (for cleanup / stale cookie recovery).
 */
export function clearActiveTenantCookies(res: NextResponse) {
  const base = { path: "/" as const };

  // delete() in NextResponse expects either:
  // - delete("name")
  // - delete({ name: "name", path: "/" })
  res.cookies.delete({ name: ACTIVE_TENANT_COOKIE, ...base });

  for (const k of LEGACY_ACTIVE_TENANT_COOKIE_KEYS) {
    res.cookies.delete({ name: k, ...base });
  }

  return res;
}