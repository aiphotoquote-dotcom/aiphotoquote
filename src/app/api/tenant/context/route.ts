// src/app/api/tenant/context/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";

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

type ContextResp =
  | { ok: true; activeTenantId: string | null; tenants: TenantRow[] }
  | { ok: false; error: string; message?: string };

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
  const jar = cookies(); // NOTE: no await
  return (
    jar.get("activeTenantId")?.value ||
    jar.get("active_tenant_id")?.value ||
    jar.get("tenantId")?.value ||
    jar.get("tenant_id")?.value ||
    null
  );
}

async function listOwnedTenants(userId: string): Promise<TenantRow[]> {
  const rows = await db
    .select({
      tenantId: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
    })
    .from(tenants)
    .where(eq(tenants.ownerClerkUserId, userId));

  return rows
    .map((r) => ({
      tenantId: String(r.tenantId),
      slug: String(r.slug),
      name: r.name ?? null,
      role: "owner" as const, // owner-only tenancy model for now
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function pickActiveTenantId(requested: string | null, list: TenantRow[]): string | null {
  if (!list.length) return null;
  if (requested && list.some((t) => t.tenantId === requested)) return requested;
  return list[0].tenantId;
}

export async function GET(): Promise<NextResponse<ContextResp>> {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }

    const tenantsList = await listOwnedTenants(userId);

    const requested = readActiveTenantIdFromCookies();
    const activeTenantId = pickActiveTenantId(requested, tenantsList);

    const res = NextResponse.json({
      ok: true,
      activeTenantId,
      tenants: tenantsList,
    });

    // If cookie missing/invalid but we can pick one, set cookies so UI doesn't crash
    if (activeTenantId && activeTenantId !== requested) {
      setTenantCookies(res, activeTenantId);
    }

    return res;
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
      return NextResponse.json({ ok: false, error: "MISSING_TENANT_SELECTOR" }, { status: 400 });
    }

    // Verify tenant is owned by this user (owner-only model)
    const where =
      tenantId && tenantSlug
        ? and(eq(tenants.id, tenantId), eq(tenants.slug, tenantSlug), eq(tenants.ownerClerkUserId, userId))
        : tenantId
          ? and(eq(tenants.id, tenantId), eq(tenants.ownerClerkUserId, userId))
          : and(eq(tenants.slug, tenantSlug!), eq(tenants.ownerClerkUserId, userId));

    const t = await db
      .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
      .from(tenants)
      .where(where)
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!t?.id) {
      return NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND_OR_FORBIDDEN" }, { status: 404 });
    }

    // Return full context for convenience (client can re-render without extra roundtrip)
    const tenantsList = await listOwnedTenants(userId);
    const activeTenantId = pickActiveTenantId(String(t.id), tenantsList);

    const res = NextResponse.json({
      ok: true,
      activeTenantId,
      tenants: tenantsList,
      tenant: { id: String(t.id), slug: String(t.slug), name: t.name ?? null },
    });

    if (activeTenantId) setTenantCookies(res, activeTenantId);
    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}