import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs, tenants } from "@/lib/db/schema";

export const runtime = "nodejs";

function getCookieTenantId(jar: Awaited<ReturnType<typeof cookies>>) {
  const candidates = [
    jar.get("activeTenantId")?.value,
    jar.get("active_tenant_id")?.value,
    jar.get("tenantId")?.value,
    jar.get("tenant_id")?.value,
  ].filter(Boolean) as string[];

  return candidates[0] || null;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.redirect(new URL("/sign-in", req.url));

  const p = await ctx.params;
  const id = String((p as any)?.id ?? "").trim();
  if (!id) return NextResponse.redirect(new URL("/admin/quotes", req.url));

  const jar = await cookies();
  let tenantIdMaybe = getCookieTenantId(jar);

  // fallback: tenant owned by this user
  if (!tenantIdMaybe) {
    const t = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.ownerClerkUserId, userId))
      .limit(1)
      .then((r) => r[0] ?? null);

    tenantIdMaybe = t?.id ?? null;
  }

  if (!tenantIdMaybe) {
    return NextResponse.redirect(new URL("/admin/quotes", req.url));
  }

  const tenantId = tenantIdMaybe;

  // Accept either form POST or JSON
  let isRead: boolean | null = null;

  const contentType = req.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => null);
      if (body && typeof body.isRead === "boolean") isRead = body.isRead;
      if (body && typeof body.value !== "undefined") isRead = String(body.value) === "1";
    } else {
      const fd = await req.formData();
      const v = fd.get("isRead") ?? fd.get("value");
      if (v != null) isRead = String(v) === "1";
    }
  } catch {
    // ignore parse errors
  }

  if (isRead === null) {
    // default: mark unread when this endpoint is hit by the button
    isRead = false;
  }

  await db
    .update(quoteLogs)
    .set({ isRead } as any)
    .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));

  return NextResponse.redirect(new URL(`/admin/quotes/${id}`, req.url));
}