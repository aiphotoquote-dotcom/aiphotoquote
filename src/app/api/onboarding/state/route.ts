// src/app/api/onboarding/state/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";

import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Mode = "new" | "update" | "existing";
type PlanTier = "tier0" | "tier1" | "tier2";

/* --------------------- helpers --------------------- */

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function safeMode(v: unknown): Mode {
  const s = safeTrim(v).toLowerCase();
  if (s === "update") return "update";
  if (s === "existing") return "existing";
  return "new";
}

/**
 * Accept both new tier names + legacy DB default "free"
 * - "free" => tier0
 */
function safePlan(v: unknown): PlanTier | null {
  const s = safeTrim(v).toLowerCase();
  if (s === "tier0" || s === "free") return "tier0";
  if (s === "tier1") return "tier1";
  if (s === "tier2") return "tier2";
  return null;
}

function planToDbValue(p: PlanTier): string {
  return p;
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

function slugify(name: string) {
  const base = safeTrim(name)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return base || `tenant-${Math.random().toString(16).slice(2, 8)}`;
}

function getQuery(req: Request) {
  try {
    const u = new URL(req.url);
    const mode = safeMode(u.searchParams.get("mode"));
    const tenantId = safeTrim(u.searchParams.get("tenantId"));
    return { mode, tenantId };
  } catch {
    return { mode: "new" as Mode, tenantId: "" };
  }
}

async function requireAuthed(): Promise<{ clerkUserId: string }> {
  const a = await auth();
  const clerkUserId = a?.userId ?? null;
  if (!clerkUserId) throw new Error("UNAUTHENTICATED");
  return { clerkUserId };
}

/**
 * ✅ IMPORTANT:
 * Your DB keys tenant membership by clerk_user_id (TEXT) + tenant_id (UUID).
 */
async function requireMembership(clerkUserId: string, tenantId: string): Promise<void> {
  const r = await db.execute(sql`
    select 1 as ok
    from tenant_members
    where tenant_id = ${tenantId}::uuid
      and clerk_user_id = ${clerkUserId}
      and status = 'active'
    limit 1
  `);
  const row = firstRow(r);
  if (!row?.ok) throw new Error("FORBIDDEN_TENANT");
}

async function ensureAppUser(clerkUserId: string): Promise<{ appUserId: string }> {
  const u = await currentUser();
  const email = u?.emailAddresses?.[0]?.emailAddress ?? null;
  const name = u?.fullName ?? u?.firstName ?? null;

  const r = await db.execute(sql`
    insert into app_users (id, auth_provider, auth_subject, email, name, created_at, updated_at)
    values (gen_random_uuid(), 'clerk', ${clerkUserId}, ${email}, ${name}, now(), now())
    on conflict (auth_provider, auth_subject) do update
      set email = coalesce(excluded.email, app_users.email),
          name  = coalesce(excluded.name,  app_users.name),
          updated_at = now()
    returning id
  `);

  const row = firstRow(r);
  const appUserId = row?.id ? String(row.id) : null;
  if (!appUserId) throw new Error("FAILED_TO_UPSERT_APP_USER");
  return { appUserId };
}

/* --------------------- NO-CACHE response headers --------------------- */

function noCacheJson(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "Surrogate-Control": "no-store",
    },
  });
}

/* --------------------- AI meta derivation (kept as-is) --------------------- */

function getConfidence(ai: any): number {
  const n = Number(ai?.confidenceScore ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function getNeedsConfirmation(ai: any): boolean {
  const v = ai?.needsConfirmation;
  if (typeof v === "boolean") return v;
  return getConfidence(ai) < 0.8;
}

function getLastCorrectionFallback(ai: any): any | null {
  const hist = Array.isArray(ai?.confirmationHistory) ? ai.confirmationHistory : [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const h = hist[i];
    if (h && h.answer === "no") return h;
  }
  return null;
}

function deriveAiMeta(aiAnalysis: any | null) {
  const target = 0.8;

  if (!aiAnalysis) {
    return {
      aiAnalysisStatus: "idle",
      aiAnalysisRound: 0,
      aiAnalysisLastAction: "",
      aiAnalysisError: null as string | null,
      aiAnalysisConfidenceTarget: target,
      aiAnalysisUserCorrection: null as any | null,
    };
  }

  const meta = aiAnalysis?.meta && typeof aiAnalysis.meta === "object" ? aiAnalysis.meta : {};

  const metaStatus = String(meta?.status ?? "").trim().toLowerCase(); // running | complete | error
  const status =
    metaStatus === "running" || metaStatus === "complete" || metaStatus === "error" ? metaStatus : "complete";

  const roundRaw = Number(meta?.round ?? NaN);
  const round =
    Number.isFinite(roundRaw) && roundRaw > 0
      ? roundRaw
      : (() => {
          const hist = Array.isArray(aiAnalysis?.confirmationHistory) ? aiAnalysis.confirmationHistory : [];
          return Math.max(1, hist.length ? hist.length : 1);
        })();

  const lastAction = String(meta?.lastAction ?? "").trim();
  const error = String(meta?.error ?? "").trim();

  const needs = getNeedsConfirmation(aiAnalysis);
  const userCorrection = meta?.userCorrection ?? getLastCorrectionFallback(aiAnalysis);

  const derivedLastAction =
    lastAction ||
    (status === "running"
      ? "Analyzing website…"
      : status === "error"
        ? "AI analysis failed."
        : needs
          ? "Waiting for your confirmation/correction."
          : "AI analysis complete.");

  return {
    aiAnalysisStatus: status,
    aiAnalysisRound: round,
    aiAnalysisLastAction: derivedLastAction,
    aiAnalysisError: error || (status === "error" ? "Unknown error" : null),
    aiAnalysisConfidenceTarget: target,
    aiAnalysisUserCorrection: userCorrection ?? null,
  };
}

/* --------------------- ai_analysis coercion + compat bridge --------------------- */

function coerceAiAnalysis(v: any): any | null {
  if (!v) return null;
  if (typeof v === "object") return v;

  // Sometimes jsonb can come back as a string depending on driver/adapter.
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * If Mode A writes ai_analysis.industryInterview but does not mirror
 * suggestedIndustryKey/confidenceScore at the root, Step3 can “feel reverted”.
 * This bridges that for the UI only (does not write back to DB).
 */
function applyModeACompat(ai: any | null): any | null {
  if (!ai || typeof ai !== "object") return ai;

  const ii = (ai as any)?.industryInterview;
  if (!ii || typeof ii !== "object") return ai;

  const mode = String((ii as any)?.mode ?? "").trim();
  if (mode !== "A") return ai;

  const proposed = (ii as any)?.proposedIndustry;
  const proposedKey = proposed && typeof proposed === "object" ? safeTrim((proposed as any).key) : "";
  const proposedLabel = proposed && typeof proposed === "object" ? safeTrim((proposed as any).label) : "";

  const confidenceScore = Number((ii as any)?.confidenceScore ?? 0);
  const conf = Number.isFinite(confidenceScore) ? confidenceScore : 0;

  // Only fill if missing — never overwrite other paths
  const next: any = { ...(ai as any) };

  if (!safeTrim(next.suggestedIndustryKey) && proposedKey) next.suggestedIndustryKey = proposedKey;
  if ((next.confidenceScore === undefined || next.confidenceScore === null) && Number.isFinite(conf)) next.confidenceScore = conf;
  if (next.needsConfirmation === undefined || next.needsConfirmation === null) next.needsConfirmation = true;

  // Optional: a friendly label hint for Step3 if you want it later
  if (!safeTrim(next.suggestedIndustryLabel) && proposedLabel) next.suggestedIndustryLabel = proposedLabel;

  return next;
}

/* --------------------- db read --------------------- */

async function readTenantOnboarding(tenantId: string) {
  const r = await db.execute(sql`
    select
      t.name as tenant_name,
      o.current_step,
      o.completed,
      o.website,
      o.ai_analysis,
      ts.plan_tier
    from tenants t
    left join tenant_onboarding o on o.tenant_id = t.id
    left join tenant_settings ts on ts.tenant_id = t.id
    where t.id = ${tenantId}::uuid
    limit 1
  `);

  const row = firstRow(r);

  const aiAnalysis0 = coerceAiAnalysis((row as any)?.ai_analysis ?? null);
  const aiAnalysis = applyModeACompat(aiAnalysis0);

  const derived = deriveAiMeta(aiAnalysis);

  const website = (row as any)?.website ?? null;
  const hasWebsite = Boolean(safeTrim(website));

  // Kept for backward compatibility (older Step3 / older interview modes)
  const industryInference = (aiAnalysis as any)?.industryInference ?? null;

  // ✅ NEW: Mode A interview state, consumed by Step2
  const industryInterview = (aiAnalysis as any)?.industryInterview ?? null;

  const planTierRaw = safeTrim((row as any)?.plan_tier);
  const planTier = safePlan(planTierRaw);

  return {
    tenantName: (row as any)?.tenant_name ?? null,
    currentStep: (row as any)?.current_step ?? 1,
    completed: (row as any)?.completed ?? false,
    website,
    hasWebsite,
    onboardingPath: (hasWebsite ? "website" : "interview") as "website" | "interview",
    aiAnalysis: aiAnalysis ?? null,
    industryInference,
    industryInterview,
    planTier: planTier ?? null,
    ...derived,
  };
}

/* --------------------- handlers --------------------- */

export async function GET(req: Request) {
  try {
    const { mode, tenantId } = getQuery(req);
    const { clerkUserId } = await requireAuthed();

    if (mode === "new" && !tenantId) {
      return noCacheJson(
        {
          ok: true,
          isAuthenticated: true,
          tenantId: null,
          tenantName: null,
          currentStep: 1,
          completed: false,
          website: null,
          hasWebsite: false,
          onboardingPath: "interview",
          aiAnalysis: null,
          industryInference: null,
          industryInterview: null,
          planTier: null,
          aiAnalysisStatus: "idle",
          aiAnalysisRound: 0,
          aiAnalysisLastAction: "",
          aiAnalysisError: null,
          aiAnalysisConfidenceTarget: 0.8,
          aiAnalysisUserCorrection: null,
        },
        200
      );
    }

    if (!tenantId) {
      return noCacheJson({ ok: false, error: "TENANT_ID_REQUIRED", message: "tenantId is required for this request." }, 400);
    }

    await requireMembership(clerkUserId, tenantId);
    const data = await readTenantOnboarding(tenantId);

    return noCacheJson(
      {
        ok: true,
        isAuthenticated: true,
        tenantId,
        ...data,
      },
      200
    );
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return noCacheJson({ ok: false, error: "INTERNAL", message: msg }, status);
  }
}

export async function POST(req: Request) {
  try {
    const { mode, tenantId: queryTenantId } = getQuery(req);
    const { clerkUserId } = await requireAuthed();

    const body = await req.json().catch(() => null);
    const step = Number((body as any)?.step);

    // ---------------- STEP 1 ----------------
    if (step === 1) {
      const businessName = safeTrim((body as any)?.businessName);
      const website = safeTrim((body as any)?.website);

      if (businessName.length < 2) {
        return noCacheJson({ ok: false, error: "BUSINESS_NAME_REQUIRED" }, 400);
      }

      const { appUserId } = await ensureAppUser(clerkUserId);

      let ownerName = safeTrim((body as any)?.ownerName);
      let ownerEmail = safeTrim((body as any)?.ownerEmail);

      if (!ownerName || !ownerEmail) {
        const u = await currentUser();
        ownerEmail = ownerEmail || (u?.emailAddresses?.[0]?.emailAddress ?? "");
        ownerName = ownerName || (u?.fullName ?? u?.firstName ?? "");
        ownerName = safeTrim(ownerName);
        ownerEmail = safeTrim(ownerEmail);
      }

      if (ownerName.length < 2) {
        return noCacheJson({ ok: false, error: "OWNER_NAME_REQUIRED" }, 400);
      }
      if (!ownerEmail.includes("@")) {
        return noCacheJson({ ok: false, error: "OWNER_EMAIL_REQUIRED" }, 400);
      }

      let tenantId: string | null = null;

      if (mode === "update" || mode === "existing") {
        const t = safeTrim((body as any)?.tenantId) || safeTrim(queryTenantId);
        if (!t) return noCacheJson({ ok: false, error: "TENANT_ID_REQUIRED" }, 400);
        await requireMembership(clerkUserId, t);
        tenantId = t;
      }

      if (!tenantId) {
        const baseSlug = slugify(businessName);
        const slug = `${baseSlug}-${Math.random().toString(16).slice(2, 6)}`;

        const tIns = await db.execute(sql`
          insert into tenants (id, name, slug, owner_user_id, owner_clerk_user_id, created_at)
          values (gen_random_uuid(), ${businessName}, ${slug}, ${appUserId}::uuid, ${clerkUserId}, now())
          returning id
        `);

        const trow = firstRow(tIns);
        if (!trow?.id) throw new Error("FAILED_TO_CREATE_TENANT");
        tenantId = String(trow.id);

        await db.execute(sql`
          insert into tenant_members (tenant_id, clerk_user_id, role, status, created_at, updated_at)
          values (${tenantId}::uuid, ${clerkUserId}, 'owner', 'active', now(), now())
          on conflict do nothing
        `);

        // NOTE: leaving placeholder industry_key for now (Mode A will propose/create later)
        await db.execute(sql`
          insert into tenant_settings (tenant_id, industry_key, business_name, updated_at)
          values (${tenantId}::uuid, 'service', ${businessName}, now())
          on conflict (tenant_id) do update
            set business_name = excluded.business_name,
                updated_at = now()
        `);
      } else {
        await db.execute(sql`
          update tenants
            set name = ${businessName}
          where id = ${tenantId}::uuid
        `);

        await db.execute(sql`
          insert into tenant_settings (tenant_id, industry_key, business_name, updated_at)
          values (${tenantId}::uuid, 'service', ${businessName}, now())
          on conflict (tenant_id) do update
            set business_name = excluded.business_name,
                updated_at = now()
        `);
      }

      // ✅ If no website, skip website analysis and go to interview/industry step
      const nextStep = website ? 2 : 3;

      await db.execute(sql`
        insert into tenant_onboarding (tenant_id, website, current_step, completed, created_at, updated_at)
        values (${tenantId}::uuid, ${website || null}, ${nextStep}, false, now(), now())
        on conflict (tenant_id) do update
          set website = excluded.website,
              current_step = greatest(tenant_onboarding.current_step, excluded.current_step),
              updated_at = now()
      `);

      return noCacheJson({ ok: true, tenantId }, 200);
    }

    /**
     * ✅ STEP NUMBER COMPATIBILITY (no drift / no breaking):
     * We previously had:
     *   - Branding save as step=5
     *   - Plan selection as step=6
     *
     * Your UI is now showing:
     *   - Branding & lead routing as Step 6 / 7
     *   - Plan as Step 7 / 7
     *
     * So we support BOTH step numbers:
     *   Branding: step 5 OR 6 (based on presence of lead_to_email / lead_to_email-ish fields)
     *   Plan:     step 6 OR 7 (based on presence of plan)
     */

    // Detect intent from payload (safer than trusting step number alone)
    const bodyLeadToEmail =
      safeTrim((body as any)?.lead_to_email) ||
      safeTrim((body as any)?.leadToEmail) ||
      safeTrim((body as any)?.leadEmail) ||
      "";
    const bodyBrandLogoUrl =
      safeTrim((body as any)?.brand_logo_url) ||
      safeTrim((body as any)?.brandLogoUrl) ||
      safeTrim((body as any)?.logoUrl) ||
      "";

    const bodyPlanRaw = (body as any)?.plan;

    const looksLikeBranding = Boolean(bodyLeadToEmail || bodyBrandLogoUrl);
    const looksLikePlan = Boolean(safePlan(bodyPlanRaw));

    // ---------------- BRANDING SAVE (supports step 5 OR 6) ----------------
    if ((step === 5 || step === 6) && looksLikeBranding && !looksLikePlan) {
      const tid = safeTrim((body as any)?.tenantId) || safeTrim(queryTenantId);
      if (!tid) return noCacheJson({ ok: false, error: "TENANT_ID_REQUIRED" }, 400);

      await requireMembership(clerkUserId, tid);

      const leadToEmail = bodyLeadToEmail;
      if (!leadToEmail.includes("@")) {
        return noCacheJson({ ok: false, error: "LEAD_EMAIL_REQUIRED", message: "Enter a valid lead email." }, 400);
      }

      const brandLogoUrl = bodyBrandLogoUrl ? bodyBrandLogoUrl : null;

      // Keep platform default; tenant can personalize later
      const platformFrom = "no-reply@aiphotoquote.com";

      /**
       * ✅ CRITICAL: do NOT touch industry_key here.
       * Industry selection is handled by /api/onboarding/industries (Step3),
       * and we must not revert it back to "service" during branding save.
       */
      await db.execute(sql`
        insert into tenant_settings (
          tenant_id,
          lead_to_email,
          brand_logo_url,
          resend_from_email,
          updated_at
        )
        values (
          ${tid}::uuid,
          ${leadToEmail},
          ${brandLogoUrl},
          ${platformFrom},
          now()
        )
        on conflict (tenant_id) do update
          set lead_to_email = excluded.lead_to_email,
              brand_logo_url = excluded.brand_logo_url,
              resend_from_email = coalesce(tenant_settings.resend_from_email, excluded.resend_from_email),
              updated_at = now()
      `);

      // Branding is Step 6 in the current UI, but keep compatibility:
      const brandingStepFloor = 6;

      await db.execute(sql`
        insert into tenant_onboarding (tenant_id, current_step, completed, created_at, updated_at)
        values (${tid}::uuid, ${brandingStepFloor}, false, now(), now())
        on conflict (tenant_id) do update
          set current_step = greatest(tenant_onboarding.current_step, ${brandingStepFloor}),
              updated_at = now()
      `);

      return noCacheJson({ ok: true, tenantId: tid }, 200);
    }

    // ---------------- PLAN SELECTION (supports step 6 OR 7) ----------------
    if ((step === 6 || step === 7) && looksLikePlan) {
      const tid = safeTrim((body as any)?.tenantId) || safeTrim(queryTenantId);
      if (!tid) return noCacheJson({ ok: false, error: "TENANT_ID_REQUIRED" }, 400);

      await requireMembership(clerkUserId, tid);

      const plan = safePlan(bodyPlanRaw);
      if (!plan) {
        return noCacheJson({ ok: false, error: "PLAN_REQUIRED", message: "Choose a valid tier." }, 400);
      }

      const monthlyLimit = plan === "tier0" ? 5 : plan === "tier1" ? 50 : null;
      const graceCredits = plan === "tier0" ? 20 : 30;

      await db.execute(sql`
        update tenant_settings
        set
          plan_tier = ${planToDbValue(plan)},
          monthly_quote_limit = ${monthlyLimit},
          activation_grace_credits = ${graceCredits},
          activation_grace_used = 0,
          plan_selected_at = now(),
          updated_at = now()
        where tenant_id = ${tid}::uuid
      `);

      // Plan is Step 7 (final) in the current UI
      const planStepFloor = 7;

      await db.execute(sql`
        insert into tenant_onboarding (tenant_id, current_step, completed, created_at, updated_at)
        values (${tid}::uuid, ${planStepFloor}, true, now(), now())
        on conflict (tenant_id) do update
          set current_step = greatest(tenant_onboarding.current_step, ${planStepFloor}),
              completed = true,
              updated_at = now()
      `);

      return noCacheJson({ ok: true, tenantId: tid, planTier: plan }, 200);
    }

    // ---------------- Legacy fallback (keep old behavior alive if needed) ----------------
    // If someone still sends EXACTLY step=5 with branding fields, or step=6 with plan,
    // the above handlers already catch it. Anything else is truly unsupported.
    return noCacheJson({ ok: false, error: "UNSUPPORTED_STEP" }, 400);
  } catch (e: any) {
    const base = e?.message ?? String(e);
    const detail =
      (e?.cause?.message && String(e.cause.message)) ||
      (e?.detail && String(e.detail)) ||
      (e?.hint && String(e.hint)) ||
      "";
    const msg = detail ? `${base} :: ${detail}` : base;

    const status = msg.includes("UNAUTHENTICATED") ? 401 : msg.includes("FORBIDDEN_TENANT") ? 403 : 500;
    return noCacheJson({ ok: false, error: "INTERNAL", message: msg }, status);
  }
}