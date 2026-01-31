// src/app/api/admin/quotes/[id]/stage/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs } from "@/lib/db/schema";
import { requireTenantRole } from "@/lib/auth/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowed = new Set(["new", "open", "in_progress", "sent", "closed"]);

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id?: string }> | { id?: string } }
) {
  // Centralized: auth + app user + active tenant cookie + tenant_members RBAC
  const gate = await requireTenantRole(["owner", "admin", "member"]);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error, message: gate.message },
      { status: gate.status }
    );
  }

  try {
    const resolved = await ctx.params;
    const id = String(resolved?.id ?? "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "MISSING_ID" }, { status: 400 });

    const form = await req.formData();
    const stage = String(form.get("stage") ?? "").toLowerCase();

    if (!allowed.has(stage)) {
      return NextResponse.json({ ok: false, error: "INVALID_STAGE" }, { status: 400 });
    }

    await db
      .update(quoteLogs)
      .set({ stage } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, gate.tenantId as any)));

    // Redirect back to the quote detail (nice UX)
    return NextResponse.redirect(new URL(`/admin/quotes/${id}`, req.url));
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}