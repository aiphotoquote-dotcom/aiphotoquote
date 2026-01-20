import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getCookieTenantId(jar: Awaited<ReturnType<typeof cookies>>) {
  const candidates = [
    jar.get("activeTenantId")?.value,
    jar.get("active_tenant_id")?.value,
    jar.get("tenantId")?.value,
    jar.get("tenant_id")?.value,
  ].filter(Boolean) as string[];

  return candidates[0] || null;
}

const allowed = new Set(["new", "open", "in_progress", "sent", "closed"]);

export async function POST(req: Request, ctx: { params: Promise<{ id?: string }> | { id?: string } }) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });

    const resolved = await ctx.params;
    const id = resolved?.id;
    if (!id) return NextResponse.json({ ok: false, error: "MISSING_ID" }, { status: 400 });

    const jar = await cookies();
    const tenantId = getCookieTenantId(jar);
    if (!tenantId) return NextResponse.json({ ok: false, error: "NO_ACTIVE_TENANT" }, { status: 400 });

    const form = await req.formData();
    const stage = String(form.get("stage") ?? "").toLowerCase();

    if (!allowed.has(stage)) {
      return NextResponse.json({ ok: false, error: "INVALID_STAGE" }, { status: 400 });
    }

    await db
      .update(quoteLogs)
      .set({ ...( { stage } as any ) })
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));

    // Redirect back to the quote detail (nice UX)
    return NextResponse.redirect(new URL(`/admin/quotes/${id}`, req.url));
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
