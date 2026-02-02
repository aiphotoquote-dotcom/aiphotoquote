// src/app/api/onboarding/analyze-website/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const { userId } = auth();
    if (!userId) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });

    const rTenant = await db.execute(sql`
      select tm.tenant_id
      from tenant_members tm
      join app_users au on au.id = tm.user_id
      where au.auth_provider = 'clerk' and au.auth_subject = ${userId}
      order by tm.created_at asc
      limit 1
    `);
    const rowT: any = (rTenant as any)?.rows?.[0] ?? null;
    const tenantId = rowT?.tenant_id ? String(rowT.tenant_id) : null;
    if (!tenantId) return NextResponse.json({ ok: false, error: "NO_TENANT" }, { status: 400 });

    const r = await db.execute(sql`
      select website
      from tenant_onboarding
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);
    const row: any = (r as any)?.rows?.[0] ?? null;
    const website = String(row?.website ?? "").trim();

    // Mock v1 (auditable); we’ll swap to OpenAI next.
    const mock = {
      fit: website ? true : "unknown",
      confidenceScore: website ? 0.78 : 0.52,
      suggestedIndustryKey: "marine",
      detectedServices: ["upholstery", "marine seating", "repairs", "custom work"],
      billingSignals: ["estimate-based", "mixed"],
      notes: website
        ? "Website suggests a service business that benefits from photo-based estimating."
        : "No website provided; we’ll confirm industry via questions next.",
      analyzedAt: new Date().toISOString(),
      source: "mock_v1",
    };

    await db.execute(sql`
      insert into tenant_onboarding (tenant_id, ai_analysis, current_step, completed, created_at, updated_at)
      values (${tenantId}::uuid, ${JSON.stringify(mock)}::jsonb, 2, false, now(), now())
      on conflict (tenant_id) do update
      set ai_analysis = excluded.ai_analysis,
          current_step = greatest(tenant_onboarding.current_step, 2),
          updated_at = now()
    `);

    return NextResponse.json({ ok: true, tenantId, aiAnalysis: mock }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "INTERNAL", message: e?.message ?? String(e) }, { status: 500 });
  }
}