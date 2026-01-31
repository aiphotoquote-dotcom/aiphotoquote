import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db/client";
import { quoteLogs } from "@/lib/db/schema";
import { requireTenantRole } from "@/lib/auth/tenant";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> | { id: string } }
) {
  // Clerk auth (kept for redirect behavior)
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  // Resolve quote id
  const p = await ctx.params;
  const id = String((p as any)?.id ?? "").trim();
  if (!id) {
    return NextResponse.redirect(new URL("/admin/quotes", req.url));
  }

  // ✅ Centralized RBAC + active tenant resolution
  const gate = await requireTenantRole(["owner", "admin", "member"]);
  if (!gate.ok) {
    return NextResponse.redirect(new URL("/admin/quotes", req.url));
  }

  const tenantId = gate.tenantId;

  // Parse desired read state
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

  // Default: mark unread if no payload
  if (isRead === null) isRead = false;

  // Update quote read state (tenant-scoped)
  await db
    .update(quoteLogs)
    .set({ isRead } as any)
    .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));

  // Redirect behavior preserved
  const redirectUrl = new URL(`/admin/quotes/${id}`, req.url);
  if (!isRead) redirectUrl.searchParams.set("stay_unread", "1");

  return NextResponse.redirect(redirectUrl);
}