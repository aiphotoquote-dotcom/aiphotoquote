import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ACTIVE_TENANT_COOKIE,
  ensureOwnerMembershipForLegacyTenants,
  listUserTenants,
} from "@/lib/auth/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

const PostBody = z.object({
  tenantId: z.string().uuid(),
});

export async function GET() {
  // bootstrap any legacy owner-only tenants into tenant_members
  await ensureOwnerMembershipForLegacyTenants();

  const tenants = await listUserTenants();

  // pick active tenant:
  // - if cookie points to a tenant the user still has, keep it
  // - otherwise pick first tenant
  // - if none, return empty
  const cookieTenantId = (await import("next/headers")).cookies().then((c) => c.get(ACTIVE_TENANT_COOKIE)?.value || "");
  const current = (await cookieTenantId).trim();

  const stillValid = tenants.find((t) => t.tenantId === current);
  const activeTenantId = stillValid?.tenantId ?? tenants[0]?.tenantId ?? null;

  return json({
    ok: true,
    activeTenantId,
    tenants,
  });
}

export async function POST(req: Request) {
  // bootstrap any legacy owner-only tenants into tenant_members
  await ensureOwnerMembershipForLegacyTenants();

  const body = await req.json().catch(() => null);
  const parsed = PostBody.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, 400);
  }

  // Ensure the requested tenant is one user belongs to
  const tenants = await listUserTenants();
  const found = tenants.find((t) => t.tenantId === parsed.data.tenantId);
  if (!found) {
    return json({ ok: false, error: "NOT_A_MEMBER_OF_TENANT" }, 403);
  }

  const res = json({ ok: true, activeTenantId: found.tenantId });

  // Set cookie for 30 days
  res.cookies.set(ACTIVE_TENANT_COOKIE, found.tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return res;
}
