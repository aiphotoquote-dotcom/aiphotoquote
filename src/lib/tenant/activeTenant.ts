// src/lib/tenant/activeTenant.ts
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

const COOKIE_PRIMARY = "activeTenantId";
const COOKIE_SECONDARY = "active_tenant_id";

// Optional legacy keys you’ve referenced elsewhere
const LEGACY_KEYS = ["tenantId", "tenant_id"] as const;

function cookieOpts() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProd,
    path: "/",
  };
}

function isUuidLike(s: string) {
  // light validation; route.ts does strict validation elsewhere
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

/**
 * Reads the active tenant id from cookies, supporting both canonical keys
 * plus optional legacy keys.
 */
export async function readActiveTenantIdFromCookies(): Promise<string | null> {
  const jar = await cookies();

  const candidates = [
    jar.get(COOKIE_PRIMARY)?.value,
    jar.get(COOKIE_SECONDARY)?.value,
    ...LEGACY_KEYS.map((k) => jar.get(k)?.value),
  ].filter(Boolean) as string[];

  const hit = candidates[0] ? String(candidates[0]).trim() : "";
  if (!hit) return null;
  return isUuidLike(hit) ? hit : null;
}

/**
 * Sets BOTH canonical cookie names so all server pages/components stay consistent.
 */
export function setActiveTenantCookie(res: NextResponse, tenantId: string): NextResponse {
  const v = String(tenantId || "").trim();
  if (!v) return res;

  // Always set both keys for compatibility
  res.cookies.set(COOKIE_PRIMARY, v, cookieOpts());
  res.cookies.set(COOKIE_SECONDARY, v, cookieOpts());

  // (Optional) also set legacy keys if you still have code reading them
  // res.cookies.set("tenantId", v, cookieOpts());
  // res.cookies.set("tenant_id", v, cookieOpts());

  return res;
}

/**
 * Clears BOTH canonical cookie names (and legacy keys if present).
 */
export function clearActiveTenantCookies(res: NextResponse): NextResponse {
  // delete() sets an expired cookie; NextResponse supports it
  res.cookies.delete(COOKIE_PRIMARY);
  res.cookies.delete(COOKIE_SECONDARY);

  // clear legacy keys too (safe)
  for (const k of LEGACY_KEYS) res.cookies.delete(k);

  return res;
}