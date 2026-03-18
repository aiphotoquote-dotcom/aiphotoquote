// src/lib/platform/tenantImpersonation.ts

import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

const IMPERSONATION_COOKIE = "apq_tenant_impersonation";

export type TenantImpersonationPayload = {
  tenantId: string;
  previousTenantId: string | null;
  actorClerkUserId: string;
  actorEmail: string | null;
  startedAt: string;
};

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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export async function readTenantImpersonationFromCookies(): Promise<TenantImpersonationPayload | null> {
  const jar = await cookies();
  const raw = jar.get(IMPERSONATION_COOKIE)?.value;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<TenantImpersonationPayload>;
    const tenantId = String(parsed?.tenantId ?? "").trim();
    const previousTenantIdRaw = String(parsed?.previousTenantId ?? "").trim();
    const actorClerkUserId = String(parsed?.actorClerkUserId ?? "").trim();
    const actorEmail = parsed?.actorEmail ? String(parsed.actorEmail).trim() : null;
    const startedAt = String(parsed?.startedAt ?? "").trim();

    if (!tenantId || !isUuidLike(tenantId)) return null;
    if (!actorClerkUserId) return null;
    if (!startedAt) return null;

    const previousTenantId =
      previousTenantIdRaw && isUuidLike(previousTenantIdRaw) ? previousTenantIdRaw : null;

    return {
      tenantId,
      previousTenantId,
      actorClerkUserId,
      actorEmail,
      startedAt,
    };
  } catch {
    return null;
  }
}

export function setTenantImpersonationCookie(
  res: NextResponse,
  payload: TenantImpersonationPayload
): NextResponse {
  res.cookies.set(IMPERSONATION_COOKIE, JSON.stringify(payload), cookieOpts());
  return res;
}

export function clearTenantImpersonationCookie(res: NextResponse): NextResponse {
  res.cookies.delete(IMPERSONATION_COOKIE);
  return res;
}