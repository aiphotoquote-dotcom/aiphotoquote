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

function normalizeWebsiteForDisplay(raw: string) {
  const s = safeTrim(raw);
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) return `https://${s}`;
  return s;
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

type AnalyzeReq = {
  tenantId?: string;
  round?: number;
  confidenceTarget?: number;
  userCorrection?: string;
  force?: boolean;
};

type WebsiteAnalysis = {
  businessSummary: {
    whatWeThinkYouDo: string;
    services: string[];
    markets: string[];
    typicalCustomers: string[];
  };
  fit: {
    verdict: "good" | "maybe" | "not_sure" | "not_a_fit";
    score: number; // 0-1
    notes: string;
  };
  confidence: {
    score: number; // 0-1
    target: number; // 0-1
    needsConfirmation: boolean;
    reason: string;
  };
  suggestedIndustryKey: string;
  suggestedIndustryLabel?: string;
  detectedServices: string[];
  billingSignals: string[];
  notes: string;
  analyzedAt: string;
  source: "mock_v2";
  modelUsed: string;
  meta: {
    round: number;
    status: "idle" | "running" | "complete" | "error";
    lastAction: string;
    userCorrection: string | null;
    website: string;
    mode: "website_only" | "website_plus_user_confirmation";
  };
};

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function safeTarget(v: unknown) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.8;
  return clamp01(n);
}

function safeRound(v: unknown) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(6, Math.floor(n)));
}

function isLikelyMarineFromWebsite(website: string) {
  const s = website.toLowerCase();
  return s.includes("boat") || s.includes("marine") || s.includes("yacht") || s.includes("dock");
}

function mockInfer(website: string, userCorrection: string | null, target: number, round: number, modelUsed: string): WebsiteAnalysis {
  const hasWebsite = Boolean(safeTrim(website));
  const hasCorrection = Boolean(safeTrim(userCorrection ?? ""));

  const websiteDisp = normalizeWebsiteForDisplay(website);

  // --- Mock “what we think you do”
  // You can make this smarter later; for now we keep it deterministic and auditable.
  let whatWeThinkYouDo = "";
  let services: string[] = [];
  let markets: string[] = [];
  let customers: string[] = [];

  if (!hasWebsite) {
    whatWeThinkYouDo =
      "We didn’t detect a website. Based on your onboarding inputs, you appear to run a service business that could benefit from photo-based estimates.";
    services = ["estimates from photos", "custom service work"];
    markets = ["local / regional"];
    customers = ["consumers", "small businesses"];
  } else if (!hasCorrection) {
    // Round 1: website-only
    const marine = isLikelyMarineFromWebsite(websiteDisp);
    whatWeThinkYouDo = marine
      ? "From your website, it looks like you offer marine-related services — likely upholstery/repairs/custom work for boats and marine seating."
      : "From your website, it looks like you run a service business that performs custom work and repairs where customers often request estimates before committing.";
    services = marine
      ? ["marine upholstery", "marine seating", "repairs", "custom work"]
      : ["repairs", "custom work", "service estimates"];
    markets = marine ? ["marinas", "coastal / lakes"] : ["local / regional"];
    customers = marine ? ["boat owners", "marinas", "captains"] : ["consumers", "small businesses"];
  } else {
    // Round 2+: incorporate user correction
    whatWeThinkYouDo =
      `You confirmed/corrected your business as: "${safeTrim(userCorrection)}". ` +
      "Based on that, we’ll tailor AI Photo Quote to your services and customer language.";
    services = ["custom quoting", "photo-based estimating", "service fulfillment"];
    markets = ["your operating region"];
    customers = ["your target customers"];
  }

  // --- Mock fit + confidence
  let confidenceScore = 0.52;
  let fitScore = 0.55;
  let fitVerdict: WebsiteAnalysis["fit"]["verdict"] = "not_sure";
  let fitNotes = "";

  if (hasWebsite && !hasCorrection) {
    confidenceScore = 0.78;
    fitScore = 0.82;
    fitVerdict = "good";
    fitNotes = "Website signals a service business where photo-based estimates and consistent intake reduce back-and-forth.";
  } else if (hasWebsite && hasCorrection) {
    confidenceScore = 0.88; // “rises” after confirmation
    fitScore = 0.86;
    fitVerdict = "good";
    fitNotes = "Your confirmation increased our confidence in the service scope and messaging.";
  } else if (!hasWebsite && hasCorrection) {
    confidenceScore = 0.74;
    fitScore = 0.78;
    fitVerdict = "maybe";
    fitNotes = "Even without a website, your confirmation helps; we can still configure the intake and prompts.";
  } else {
    confidenceScore = 0.52;
    fitScore = 0.62;
    fitVerdict = "not_sure";
    fitNotes = "We need either a website or a short confirmation from you to tailor the setup.";
  }

  const needsConfirmation = confidenceScore < target;
  const reason = needsConfirmation
    ? "We need you to confirm/correct what we think you do to raise confidence before auto-configuring industry defaults."
    : "Confidence is high enough to proceed with industry defaults.";

  const suggestedIndustryKey = "marine"; // for now; later from PCC prompt/model

  return {
    businessSummary: {
      whatWeThinkYouDo,
      services,
      markets,
      typicalCustomers: customers,
    },
    fit: {
      verdict: fitVerdict,
      score: clamp01(fitScore),
      notes: fitNotes,
    },
    confidence: {
      score: clamp01(confidenceScore),
      target,
      needsConfirmation,
      reason,
    },
    suggestedIndustryKey,
    suggestedIndustryLabel: "Marine",
    detectedServices: services,
    billingSignals: ["estimate-based", "mixed"],
    notes: hasWebsite
      ? "Website suggests a service business that benefits from photo-based estimating."
      : "No website provided; we’ll confirm details via your response.",
    analyzedAt: new Date().toISOString(),
    source: "mock_v2",
    modelUsed,
    meta: {
      round,
      status: "complete",
      lastAction: "AI analysis complete.",
      userCorrection: safeTrim(userCorrection) ? safeTrim(userCorrection) : null,
      website: websiteDisp,
      mode: hasCorrection ? "website_plus_user_confirmation" : "website_only",
    },
  };
}

export async function POST(req: Request) {
  try {
    const { clerkUserId } = await requireAuthed();

    const body = (await req.json().catch(() => null)) as AnalyzeReq | null;
    const tenantId = safeTrim(body?.tenantId);
    if (!tenantId) return NextResponse.json({ ok: false, error: "TENANT_ID_REQUIRED" }, { status: 400 });

    await requireMembership(clerkUserId, tenantId);

    // Pull onboarding model from PCC LLM config (falls back to defaults if config missing)
    const cfg = await loadPlatformLlmConfig();
    const onboardingModel =
      String((cfg as any)?.models?.onboardingModel ?? "").trim() ||
      String((cfg as any)?.models?.estimatorModel ?? "").trim() ||
      "gpt-4o-mini";

    const target = safeTarget(body?.confidenceTarget);
    const userCorrection = safeTrim(body?.userCorrection);

    // Read website + existing analysis meta (to auto-increment round if not provided)
    const r0 = await db.execute(sql`
      select website, ai_analysis
      from tenant_onboarding
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);
    const row0 = firstRow(r0);
    const website = normalizeWebsiteForDisplay(String(row0?.website ?? "").trim());

    const prev = row0?.ai_analysis ?? null;
    const prevRound = Number(prev?.meta?.round ?? 0);
    const nextRound = body?.round ? safeRound(body.round) : safeRound(prevRound + 1 || 1);

    // Mark status=running (so UI can show it if it refreshes mid-run)
    const runningMeta = {
      ...(typeof prev === "object" && prev ? prev : {}),
      meta: {
        ...(typeof prev?.meta === "object" && prev?.meta ? prev.meta : {}),
        round: nextRound,
        status: "running",
        lastAction: "AI analysis running…",
        userCorrection: userCorrection || null,
        website,
        mode: userCorrection ? "website_plus_user_confirmation" : "website_only",
      },
    };

    await db.execute(sql`
      insert into tenant_onboarding (tenant_id, ai_analysis, current_step, completed, created_at, updated_at)
      values (${tenantId}::uuid, ${JSON.stringify(runningMeta)}::jsonb, 2, false, now(), now())
      on conflict (tenant_id) do update
      set ai_analysis = excluded.ai_analysis,
          current_step = greatest(tenant_onboarding.current_step, 2),
          updated_at = now()
    `);

    // Build the new analysis (mock v2)
    const analysis = mockInfer(website, userCorrection || null, target, nextRound, onboardingModel);

    await db.execute(sql`
      insert into tenant_onboarding (tenant_id, ai_analysis, current_step, completed, created_at, updated_at)
      values (${tenantId}::uuid, ${JSON.stringify(analysis)}::jsonb, 2, false, now(), now())
      on conflict (tenant_id) do update
      set ai_analysis = excluded.ai_analysis,
          current_step = greatest(tenant_onboarding.current_step, 2),
          updated_at = now()
    `);

    return NextResponse.json({ ok: true, tenantId, aiAnalysis: analysis, round: nextRound }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}