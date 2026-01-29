// src/app/api/admin/dashboard/metrics/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs } from "@/lib/db/schema";
import { requireAppUserId } from "@/lib/auth/requireAppUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getTenantIdFromCookies(jar: any) {
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
    // ✅ Ensure signed-in (prevents HTML/redirect responses that break safeJson())
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }

    // ✅ Ensure app_user exists
    await requireAppUserId();

    const jar = await cookies();
    const tenantId = getTenantIdFromCookies(jar);

    if (!tenantId) {
      return NextResponse.json(
        { ok: false, error: "NO_ACTIVE_TENANT", message: "No active tenant selected." },
        { status: 400 }
      );
    }

    const now = new Date();
    const since7d = new Date(now);
    since7d.setDate(since7d.getDate() - 7);

    // "New leads last 7 days"
    const newLeads7d = await db
      .select({ c: sql<number>`count(*)` })
      .from(quoteLogs)
      .where(and(eq(quoteLogs.tenantId, tenantId), gte(quoteLogs.createdAt, since7d)))
      .then((r) => Number(r?.[0]?.c ?? 0));

    // "Quoted last 7 days" (stage == quoted)
    const quoted7d = await db
      .select({ c: sql<number>`count(*)` })
      .from(quoteLogs)
      .where(
        and(eq(quoteLogs.tenantId, tenantId), eq(quoteLogs.stage, "quoted"), gte(quoteLogs.createdAt, since7d))
      )
      .then((r) => Number(r?.[0]?.c ?? 0));

    // We don’t have a reliable “response time” signal in schema here yet.
    // Keep it null until we add first_response_at / first_contact_at.
    const avgResponseMinutes7d: number | null = null;

    // We can wire this to ai_policy later; for now keep null to avoid breaking UI.
    const renderEnabled: boolean | null = null;

    return NextResponse.json({
      ok: true,
      metrics: {
        newLeads7d,
        quoted7d,
        avgResponseMinutes7d,
        renderEnabled,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}