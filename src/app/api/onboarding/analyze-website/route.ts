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

function normalizeWebsite(raw: string) {
  const s = safeTrim(raw);
  if (!s) return "";
  // If user typed "kwickeycustoms.com" or "www.foo.com" -> make it a URL
  if (!/^https?:\/\//i.test(s)) return `https://${s}`;
  return s;
}

function firstRow(r: any): any | null {
  if (!r) return null;
  if (Array.isArray(r)) return r[0] ?? null;
  if (Array.isArray(r.rows)) return r.rows[0] ?? null;
  return null;
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

export async function POST(req: Request) {
  try {
    const { clerkUserId } = await requireAuthed();

    const body = await req.json().catch(() => null);

    const tenantId = safeTrim(body?.tenantId);
    if (!tenantId) return NextResponse.json({ ok: false, error: "TENANT_ID_REQUIRED" }, { status: 400 });

    await requireMembership(clerkUserId, tenantId);

    // ✅ IMPORTANT: accept website from the client (Step2 sends it) and persist it
    const bodyWebsite = normalizeWebsite(body?.website);

    // If website wasn’t provided in body, fall back to whatever is in tenant_onboarding (legacy)
    const existing = await db.execute(sql`
      select website
      from tenant_onboarding
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);
    const existingRow: any = (existing as any)?.rows?.[0] ?? null;
    const dbWebsite = normalizeWebsite(existingRow?.website);

    const website = bodyWebsite || dbWebsite;

    // Pull onboarding model from PCC LLM config (falls back to defaults if config missing)
    const cfg = await loadPlatformLlmConfig();
    const onboardingModel =
      String((cfg as any)?.models?.onboardingModel ?? "").trim() ||
      String((cfg as any)?.models?.estimatorModel ?? "").trim() ||
      "gpt-4o-mini";

    /**
     * Mock v2 (auditable, UI-friendly)
     * This matches the Step2 UI expectations:
     * - businessGuess: string
     * - confidenceScore: number 0..1
     * - needsConfirmation: boolean
     * - questions: string[]
     * - suggestedIndustryKey: string
     * - extractedTextPreview: string
     */
    const hasWebsite = Boolean(website);

    const confidenceScore = hasWebsite ? 0.72 : 0.52; // mock – later driven by LLM + confirmations
    const needsConfirmation = confidenceScore < 0.8;

    const aiAnalysis = {
      source: "mock_v2",
      modelUsed: onboardingModel,
      analyzedAt: new Date().toISOString(),

      website: website || null,

      // What the UI shows
      businessGuess: hasWebsite
        ? `Based on your website (${website}), it looks like you offer custom automotive work and related services. If that’s not accurate, tell us what you actually do (what you service + the types of work).`
        : "No website was provided, so I can’t auto-detect what you do yet. Tell me what you service (boats/cars/etc.) and what kind of work you perform.",

      questions: hasWebsite
        ? [
            "What do you work on most (cars/trucks/boats/other)?",
            "What are your top 3 services (short list)?",
            "Do you do mostly cosmetic upgrades, repairs, or both?",
            "Do you serve retail customers, businesses, or both?",
          ]
        : [
            "What kind of work do you do (short description)?",
            "Who do you typically serve (boats/cars/homes/other)?",
          ],

      confidenceScore,
      needsConfirmation,

      // Used later by Step3 + industry selection
      suggestedIndustryKey: "automotive",

      detectedServices: hasWebsite
        ? ["custom automotive work", "upgrades", "repairs"]
        : ["unknown"],

      billingSignals: ["estimate-based", "mixed"],

      extractedTextPreview: hasWebsite
        ? `Mock preview: Successfully received website URL: ${website}`
        : "Mock preview: No website stored yet.",
    };

    // ✅ Upsert: persist website + analysis and bump step
    await db.execute(sql`
      insert into tenant_onboarding (tenant_id, website, ai_analysis, current_step, completed, created_at, updated_at)
      values (${tenantId}::uuid, ${website || null}, ${JSON.stringify(aiAnalysis)}::jsonb, 2, false, now(), now())
      on conflict (tenant_id) do update
      set website = excluded.website,
          ai_analysis = excluded.ai_analysis,
          current_step = greatest(tenant_onboarding.current_step, 2),
          updated_at = now()
    `);

    return NextResponse.json({ ok: true, tenantId, aiAnalysis }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}