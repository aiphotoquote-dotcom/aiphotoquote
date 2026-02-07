// src/app/api/admin/tenant/activate/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

// Drizzle RowList can be array-like; avoid `.rows`
function firstRow(r: any): any | null {
  try {
    if (!r) return null;
    if (Array.isArray(r)) return r[0] ?? null;
    if (typeof r === "object" && r !== null && 0 in r) return (r as any)[0] ?? null;
    return null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.redirect(new URL("/sign-in", req.url));

    const u = new URL(req.url);
    const tenantId = safeTrim(u.searchParams.get("tenantId"));
    const next = safeTrim(u.searchParams.get("next")) || "/admin";

    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "TENANT_ID_REQUIRED" }, { status: 400 });
    }

    // Validate membership (active only)
    const r = await db.execute(sql`
      select 1 as ok
      from tenant_members
      where tenant_id = ${tenantId}::uuid
        and clerk_user_id = ${userId}
        and status = 'active'
      limit 1
    `);

    const row = firstRow(r);
    if (!row?.ok) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_TENANT" }, { status: 403 });
    }

    const res = NextResponse.redirect(new URL(next, req.url));

    // Set BOTH cookie names your app commonly reads
    res.cookies.set("activeTenantId", tenantId, { path: "/", httpOnly: true, sameSite: "lax", secure: true });
    res.cookies.set("active_tenant_id", tenantId, { path: "/", httpOnly: true, sameSite: "lax", secure: true });

    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}