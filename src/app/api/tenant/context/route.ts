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

export async function GET(req: Request) {
  // Bootstrap legacy tenants (owner_clerk_user_id) into tenant_members if needed
  await ensureOwnerMembershipForLegacyTenants();

  const tenants = await listUserTenants();

  // Read cookie (if any)
  const cookieHeader = req.headers.get("cookie") || "";
  const cookieMatch = cookieHeader
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${ACTIVE_TENANT_COOKIE}=`));
  const current = cookieMatch ? decodeURIComponent(cookieMatch.split("=").slice(1).join("=")) : "";

  // Determine active tenant
  const stillValid = tenants.find((t) => t.tenantId === current);
  const activeTenantId = stillValid?.tenantId ?? tenants[0]?.tenantId ?? null;

  const res = json({
    ok: true,
    activeTenantId,
    tenants,
  });

  // If cookie missing/invalid and we have a tenant, set it
  if (activeTenantId && activeTenantId !== current) {
    res.cookies.set(ACTIVE_TENANT_COOKIE, activeTenantId, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
  }

  return res;
}

export async function POST(req: Request) {
  await ensureOwnerMembershipForLegacyTenants();

  const body = await req.json().catch(() => null);
  const parsed = PostBody.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, 400);
  }

  // Ensure user belongs to that tenant
  const tenants = await listUserTenants();
  const found = tenants.find((t) => t.tenantId === parsed.data.tenantId);
  if (!found) {
    return json({ ok: false, error: "NOT_A_MEMBER_OF_TENANT" }, 403);
  }

  const res = json({ ok: true, activeTenantId: found.tenantId });

  res.cookies.set(ACTIVE_TENANT_COOKIE, found.tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return res;
}
