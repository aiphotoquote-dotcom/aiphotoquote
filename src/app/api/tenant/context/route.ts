// src/app/api/tenant/context/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { and, eq, or } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { requireAppUserId } from "@/lib/auth/requireAppUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tenantId: z.string().uuid().optional(),
  tenantSlug: z.string().min(3).optional(),
});

function setTenantCookies(res: NextResponse, tenantId: string) {
  const isProd = process.env.NODE_ENV === "production";
  const opts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProd,
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  };

  // set BOTH keys because your code checks multiple names
  res.cookies.set("activeTenantId", tenantId, opts);
  res.cookies.set("active_tenant_id", tenantId, opts);
  res.cookies.set("tenantId", tenantId, opts);
  res.cookies.set("tenant_id", tenantId, opts);

  return res;
}

function readActiveTenantIdFromCookies(): string | null {
  const jar = cookies(); // Next 16: not async
  return (
    jar.get("activeTenantId")?.value ||
    jar.get("active_tenant_id")?.value ||
    jar.get("tenantId")?.value ||
    jar.get("tenant_id")?.value ||
    null
  );
}

export async function GET() {
  try {
    const tenantId = readActiveTenantIdFromCookies();
    return NextResponse.json({ ok: true, tenantId });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }

    // portable internal user id (app_users.id)
    const appUserId = await requireAppUserId();

    const json = await req.json().catch(() => null);
    const parsed = Body.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "INVALID_BODY", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { tenantId, tenantSlug } = parsed.data;

    // Require at least one selector
    if (!tenantId && !tenantSlug) {
      return NextResponse.json(
        { ok: false, error: "MISSING_TENANT_SELECTOR" },
        { status: 400 }
      );
    }

    // Back-compat ownership: owner_user_id OR owner_clerk_user_id
    const ownedByMe = or(eq(tenants.ownerUserId, appUserId), eq(tenants.ownerClerkUserId, userId));

    const where =
      tenantId && tenantSlug
        ? and(eq(tenants.id, tenantId), eq(tenants.slug, tenantSlug), ownedByMe)
        : tenantId
          ? and(eq(tenants.id, tenantId), ownedByMe)
          : and(eq(tenants.slug, tenantSlug!), ownedByMe);

    const t = await db
      .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
      .from(tenants)
      .where(where)
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!t) {
      return NextResponse.json(
        { ok: false, error: "TENANT_NOT_FOUND_OR_NOT_OWNED" },
        { status: 404 }
      );
    }

    const res = NextResponse.json({
      ok: true,
      tenant: { id: t.id, slug: t.slug, name: t.name },
    });

    return setTenantCookies(res, t.id);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}