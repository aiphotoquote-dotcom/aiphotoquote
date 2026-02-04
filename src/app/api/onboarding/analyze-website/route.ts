// src/app/api/onboarding/analyze-website/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db/client";
import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function normalizeWebsite(raw: string) {
  const s = safeTrim(raw);
  if (!s) return "";
  // If user typed "example.com" or "www.example.com", make it a real URL-ish string.
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

async function requireAuthed(): Promise<{ clerkUserId: string }> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHENTICATED");
  return { clerkUserId: userId };
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

async function readOnboardingWebsite(tenantId: string): Promise<string> {
  const r = await db.execute(sql`
    select website
    from tenant_onboarding
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);
  const row: any = (r as any)?.rows?.[0] ?? null;
  return safeTrim(row?.website);
}

export async function POST(req: Request) {
  try {
    const { clerkUserId } = await requireAuthed();

    const body = await req.json().catch(() => null);
    const tenantId = safeTrim(body?.tenantId);
    if (!tenantId) return NextResponse.json({ ok: false, error: "TENANT_ID_REQUIRED" }, { status: 400 });

    await requireMembership(clerkUserId, tenantId);

    // Pull onboarding model from PCC LLM config (falls back to defaults if config missing)
    const cfg = await loadPlatformLlmConfig();
    const onboardingModel =
      safeTrim((cfg as any)?.models?.onboardingModel) ||
      safeTrim((cfg as any)?.models?.estimatorModel) ||
      "gpt-4o-mini";

    // Prefer website passed from client (wizard), fallback to DB.
    const websiteFromBody = safeTrim(body?.website);
    const websiteFromDb = await readOnboardingWebsite(tenantId);

    const website = normalizeWebsite(websiteFromBody || websiteFromDb);

    // Mock v1 (auditable); we’ll swap to OpenAI next.
    const hasWebsite = website.length > 0;

    const mock = {
      fit: hasWebsite ? true : "unknown",
      confidenceScore: hasWebsite ? 0.78 : 0.52,
      suggestedIndustryKey: "marine",
      detectedServices: ["upholstery", "marine seating", "repairs", "custom work"],
      billingSignals: ["estimate-based", "mixed"],
      notes: hasWebsite
        ? "Website suggests a service business that benefits from photo-based estimating."
        : "No website provided; we’ll confirm industry via questions next.",
      analyzedAt: new Date().toISOString(),
      source: "mock_v1",
      modelUsed: onboardingModel,
    };

    // Persist AI analysis AND also persist website if we have it (keeps Step 2 + analysis consistent)
    await db.execute(sql`
      insert into tenant_onboarding (tenant_id, website, ai_analysis, current_step, completed, created_at, updated_at)
      values (
        ${tenantId}::uuid,
        ${website || null},
        ${JSON.stringify(mock)}::jsonb,
        2,
        false,
        now(),
        now()
      )
      on conflict (tenant_id) do update
      set website = coalesce(excluded.website, tenant_onboarding.website),
          ai_analysis = excluded.ai_analysis,
          current_step = greatest(tenant_onboarding.current_step, 2),
          updated_at = now()
    `);

    return NextResponse.json({ ok: true, tenantId, website: website || null, aiAnalysis: mock }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}