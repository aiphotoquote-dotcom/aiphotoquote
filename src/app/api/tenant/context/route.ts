// src/app/api/tenant/context/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TenantRow = {
  tenantId: string;
  slug: string;
  name: string | null;
  role: "owner" | "admin" | "member";
};

const Body = z.object({
  tenantId: z.string().uuid().optional(),
  tenantSlug: z.string().min(3).optional(),
});

function getActiveTenantIdFromJar(jar: Awaited<ReturnType<typeof cookies>>) {
  return (
    jar.get("activeTenantId")?.value ||
    jar.get("active_tenant_id")?.value ||
    jar.get("tenantId")?.value ||
    jar.get("tenant_id")?.value ||
    null
  );
}

function setTenantCookies(res: NextResponse, tenantId: string) {
  const isProd = process.env.NODE_ENV === "production";

  const opts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProd,
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  };

  // set BOTH keys because different parts of your app check different names
  res.cookies.set("activeTenantId", tenantId, opts);
  res.cookies.set("active_tenant_id", tenantId, opts);
  res.cookies.set("tenantId", tenantId, opts);
  res.cookies.set("tenant_id", tenantId, opts);

  return res;
}

async function listUserTenants(userId: string): Promise<TenantRow[]> {
  // For now we treat "owned tenants" as role=owner.
  // If you later want tenant_members support, we’ll expand this query.
  const rows = await db
    .select({
      id: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
    })
    .from(tenants)
    .where(eq(tenants.ownerClerkUserId, userId))
    .orderBy(desc(tenants.createdAt));

  return rows.map((t) => ({
    tenantId: t.id,
    slug: t.slug,
    name: t.name ?? null,
    role: "owner",
  }));
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }

    // ✅ FIX: cookies() must be awaited in your build
    const jar = await cookies();

    const tenantsList = await listUserTenants(userId);

    let activeTenantId = getActiveTenantIdFromJar(jar);

    // If cookie is missing/invalid, pick first tenant (if any) and set cookies
    const activeIsValid =
      activeTenantId && tenantsList.some((t) => t.tenantId === activeTenantId);

    if (!activeIsValid) {
      activeTenantId = tenantsList[0]?.tenantId ?? null;

      const res = NextResponse.json({
        ok: true,
        activeTenantId,
        tenants: tenantsList,
      });

      if (activeTenantId) setTenantCookies(res, activeTenantId);
      return res;
    }

    return NextResponse.json({
      ok: true,
      activeTenantId,
      tenants: tenantsList,
    });
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

    const json = await req.json().catch(() => null);
    const parsed = Body.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "INVALID_BODY", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { tenantId, tenantSlug } = parsed.data;

    if (!tenantId && !tenantSlug) {
      return NextResponse.json(
        { ok: false, error: "MISSING_TENANT_SELECTOR" },
        { status: 400 }
      );
    }

    // Verify tenant is owned by this user (hard stop)
    const where =
      tenantId && tenantSlug
        ? and(
            eq(tenants.id, tenantId),
            eq(tenants.slug, tenantSlug),
            eq(tenants.ownerClerkUserId, userId)
          )
        : tenantId
          ? and(eq(tenants.id, tenantId), eq(tenants.ownerClerkUserId, userId))
          : and(eq(tenants.slug, tenantSlug!), eq(tenants.ownerClerkUserId, userId));

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

    const tenantsList = await listUserTenants(userId);

    const res = NextResponse.json({
      ok: true,
      activeTenantId: t.id,
      tenants: tenantsList,
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