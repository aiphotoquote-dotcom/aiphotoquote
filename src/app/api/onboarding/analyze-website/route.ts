// src/app/api/onboarding/analyze-website/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";

import { db } from "@/lib/db/client";
import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ONBOARDING_TENANT_COOKIE = "onboarding_tenant_id";
type Mode = "new" | "update";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function firstRow(r: any): any | null {
  if (!r) return null;
  if (Array.isArray(r)) return r[0] ?? null;
  if (Array.isArray(r.rows)) return r.rows[0] ?? null;
  return null;
}

async function requireMembership(clerkUserId: string, tenantId: string): Promise<void> {
  const r = await db.execute(sql`
    select 1 as ok
    from tenant_members
    where tenant_id = ${tenantId}::uuid
      and clerk_user_id = ${clerkUserId}
    limit 1
  `);
  const row = firstRow(r);
  if (!row?.ok) throw new Error("FORBIDDEN_TENANT");
}

function parseMode(req: Request): Mode {
  try {
    const u = new URL(req.url);
    const m = safeTrim(u.searchParams.get("mode")).toLowerCase();
    return m === "update" ? "update" : "new";
  } catch {
    return "new";
  }
}

function parseTenantIdQuery(req: Request): string {
  try {
    const u = new URL(req.url);
    return safeTrim(u.searchParams.get("tenantId"));
  } catch {
    return "";
  }
}

export async function POST(req: Request) {
  try {
    const a = await auth();
    const clerkUserId = a.userId;
    if (!clerkUserId) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });

    const mode = parseMode(req);

    const body = await req.json().catch(() => ({}));
    const bodyTenantId = safeTrim((body as any)?.tenantId);

    let tenantId: string | null = null;

    if (mode === "update") {
      // update: tenantId can come from query or body
      const qTenantId = parseTenantIdQuery(req);
      tenantId = bodyTenantId || qTenantId;
      if (!tenantId) return NextResponse.json({ ok: false, error: "TENANT_ID_REQUIRED" }, { status: 400 });
      await requireMembership(clerkUserId, tenantId);
    } else {
      // new: prefer body tenantId (from state) else cookie
      tenantId = bodyTenantId || safeTrim((await cookies()).get(ONBOARDING_TENANT_COOKIE)?.value ?? "");
      if (!tenantId) return NextResponse.json({ ok: false, error: "NO_TENANT" }, { status: 400 });
      await requireMembership(clerkUserId, tenantId);
    }

    // Pull onboarding model from PCC LLM config (falls back to defaults if config missing)
    const cfg = await loadPlatformLlmConfig();
    const onboardingModel =
      String((cfg as any)?.models?.onboardingModel ?? "").trim() ||
      String((cfg as any)?.models?.estimatorModel ?? "").trim() ||
      "gpt-4o-mini";

    const r = await db.execute(sql`
      select website
      from tenant_onboarding
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);

    const row: any = firstRow(r);
    const website = safeTrim(row?.website);

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
      modelUsed: onboardingModel,
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
    const msg = e?.message ?? String(e);
    const status = msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}