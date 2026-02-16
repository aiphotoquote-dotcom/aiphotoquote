// src/app/api/quote/submit/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import crypto from "crypto";

import { db } from "@/lib/db/client";
import { tenants, tenantSettings, quoteLogs, platformConfig } from "@/lib/db/schema";

import { sendEmail } from "@/lib/email";
import { getTenantEmailConfig } from "@/lib/email/tenantEmail";
import { renderLeadNewEmailHTML } from "@/lib/email/templates/leadNew";
import { renderCustomerReceiptEmailHTML } from "@/lib/email/templates/customerReceipt";

import { resolveTenantLlm } from "@/lib/pcc/llm/resolveTenant";

import {
  computeEstimate,
  type PricingPolicySnapshot,
  type PricingConfigSnapshot,
  type PricingRulesSnapshot,
} from "@/lib/pricing/computeEstimate";

import { buildLlmContext } from "@/lib/llm/context";
import type { KeySource } from "@/lib/llm/types";

export const runtime = "nodejs";

// ----------------- schemas -----------------
const CustomerSchema = z.object({
  name: z.string().min(2, "Name is required"),
  phone: z.string().min(7, "Phone is required"),
  email: z.string().email("Valid email is required"),
});

const QaAnswerSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});

const Req = z.object({
  tenantSlug: z.string().min(3),

  images: z
    .array(z.object({ url: z.string().url(), shotType: z.string().optional() }))
    .min(1)
    .max(12)
    .optional(),

  customer: CustomerSchema.optional(),
  contact: CustomerSchema.optional(),

  render_opt_in: z.boolean().optional(),

  customer_context: z
    .object({
      notes: z.string().optional(),
      service_type: z.string().optional(),
      category: z.string().optional(), // back-compat
    })
    .optional(),

  quoteLogId: z.string().uuid().optional(),

  // accept BOTH:
  // - [{question, answer}]
  // - ["answer1", "answer2"]
  qaAnswers: z.union([z.array(QaAnswerSchema), z.array(z.string().min(1))]).optional(),
});

type BrandLogoVariant = "light" | "dark" | "auto" | string | null;

type AiMode = "assessment_only" | "range" | "fixed";
type PricingModel =
  | "flat_per_job"
  | "hourly_plus_materials"
  | "per_unit"
  | "packages"
  | "line_items"
  | "inspection_only"
  | "assessment_fee";

// ----------------- helpers -----------------
function normalizePhone(raw: string) {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d;
}

function clampMoney(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function ensureLowHigh(low: number, high: number) {
  const a = clampMoney(low);
  const b = clampMoney(high);
  return a <= b ? { low: a, high: b } : { low: b, high: a };
}

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function normalizeBrandLogoVariant(v: unknown): BrandLogoVariant {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "light" || s === "dark" || s === "auto") return s;
  return s;
}

function getBaseUrl(req: Request) {
  const envBase = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim() || "";
  if (envBase) return envBase.replace(/\/+$/, "");

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;

  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`.replace(/\/+$/, "");

  return "";
}

function nowIso() {
  return new Date().toISOString();
}

function containsDenylistedText(s: string, denylist: string[]) {
  const hay = String(s ?? "").toLowerCase();
  return denylist.some((w) => hay.includes(String(w).toLowerCase()));
}

function sleepMs(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function sha256Hex(s: string) {
  const v = String(s ?? "");
  return crypto.createHash("sha256").update(v).digest("hex");
}

function pickIndustrySnapshotFromInput(inputAny: any): string {
  const a = safeTrim(inputAny?.industryKeySnapshot);
  if (a) return a;
  const b = safeTrim(inputAny?.industry_key_snapshot);
  if (b) return b;
  const c = safeTrim(inputAny?.customer_context?.category);
  if (c) return c;
  return "";
}

function isAiMode(v: string): v is AiMode {
  return v === "assessment_only" || v === "range" || v === "fixed";
}
function isPricingModel(v: string): v is PricingModel {
  return (
    v === "flat_per_job" ||
    v === "hourly_plus_materials" ||
    v === "per_unit" ||
    v === "packages" ||
    v === "line_items" ||
    v === "inspection_only" ||
    v === "assessment_fee"
  );
}

/**
 * Normalize pricing policy to your rule:
 * - If pricing_enabled is false => force assessment_only + clear pricing_model.
 */
function normalizePricingPolicy(pp: PricingPolicySnapshot): PricingPolicySnapshot {
  if (!pp.pricing_enabled) {
    return { ai_mode: "assessment_only", pricing_enabled: false, pricing_model: null };
  }
  const ai_mode: AiMode = isAiMode(pp.ai_mode as any) ? (pp.ai_mode as AiMode) : "range";
  const pricing_model = (pp.pricing_model as any) ?? null;
  return { ai_mode, pricing_enabled: true, pricing_model };
}

/**
 * Hard gate:
 * - Phase1 must honor resolved.tenant.pricingEnabled
 * - Phase2 uses frozen snapshot from the quote log (if present)
 */
function applyPricingEnabledGate(policy: PricingPolicySnapshot, pricingEnabled: boolean): PricingPolicySnapshot {
  if (!pricingEnabled) {
    return normalizePricingPolicy({ ai_mode: "assessment_only", pricing_enabled: false, pricing_model: null });
  }
  return normalizePricingPolicy(policy);
}

function pickPricingPolicyFromInput(inputAny: any): PricingPolicySnapshot | null {
  const pp = inputAny?.pricing_policy_snapshot;
  if (pp && typeof pp === "object") {
    const ai_mode_raw = safeTrim(pp.ai_mode);
    const ai_mode: AiMode = isAiMode(ai_mode_raw) ? (ai_mode_raw as AiMode) : "assessment_only";
    const pricing_enabled = Boolean(pp.pricing_enabled);
    const pricing_model_raw = safeTrim(pp.pricing_model);
    const pricing_model = isPricingModel(pricing_model_raw) ? (pricing_model_raw as PricingModel) : null;
    return normalizePricingPolicy({ ai_mode, pricing_enabled, pricing_model });
  }

  // back-compat
  const ai_mode_raw = safeTrim(inputAny?.ai_mode_snapshot);
  const pricing_enabled_raw = inputAny?.pricing_enabled_snapshot;
  const pricing_model_raw = safeTrim(inputAny?.pricing_model_snapshot);

  const ai_mode: AiMode = isAiMode(ai_mode_raw) ? (ai_mode_raw as AiMode) : "assessment_only";
  const pricing_enabled = typeof pricing_enabled_raw === "boolean" ? pricing_enabled_raw : Boolean(pricing_enabled_raw);
  const pricing_model = isPricingModel(pricing_model_raw) ? (pricing_model_raw as PricingModel) : null;

  return normalizePricingPolicy({ ai_mode, pricing_enabled, pricing_model });
}

function pickPricingConfigFromInput(inputAny: any): PricingConfigSnapshot | null {
  const pc = inputAny?.pricing_config_snapshot;
  if (pc && typeof pc === "object") return pc as PricingConfigSnapshot;
  return null;
}

function pickPricingRulesFromInput(inputAny: any): PricingRulesSnapshot | null {
  const pr = inputAny?.pricing_rules_snapshot;
  if (pr && typeof pr === "object") return pr as PricingRulesSnapshot;
  return null;
}

function startOfMonthUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}
function startOfNextMonthUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

function isDebugEnabled(req: Request) {
  const h = req.headers.get("x-apq-debug");
  if (h && h.trim() === "1") return true;
  try {
    const u = new URL(req.url);
    return u.searchParams.get("debug") === "1";
  } catch {
    return false;
  }
}

function safeDbTargetFromEnv(): { host: string | null; db: string | null } {
  const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
  if (!raw) return { host: null, db: null };
  try {
    const u = new URL(raw);
    return { host: u.host || null, db: (u.pathname || "").replace("/", "") || null };
  } catch {
    return { host: "unparseable", db: null };
  }
}

type DebugFn = (stage: string, data?: Record<string, any>) => void;

/**
 * ✅ Enforce estimate shape to match AI mode:
 * - assessment_only => 0/0
 * - fixed => high == low
 * - range => as-is
 */
function applyAiModeToEstimates(
  policy: PricingPolicySnapshot,
  estimates: { estimate_low: number; estimate_high: number }
) {
  const p = normalizePricingPolicy(policy);

  if (!p.pricing_enabled || p.ai_mode === "assessment_only") {
    return { estimate_low: 0, estimate_high: 0 };
  }

  const { low, high } = ensureLowHigh(estimates.estimate_low, estimates.estimate_high);

  if (p.ai_mode === "fixed") {
    return { estimate_low: low, estimate_high: low };
  }

  return { estimate_low: low, estimate_high: high };
}

/**
 * Enforce monthly quote limits (Phase 1 only)
 */
async function enforceMonthlyLimit(args: { tenantId: string; monthlyQuoteLimit: number | null }) {
  const { tenantId, monthlyQuoteLimit } = args;
  if (!monthlyQuoteLimit || !Number.isFinite(monthlyQuoteLimit) || monthlyQuoteLimit <= 0) return;

  const now = new Date();
  const from = startOfMonthUTC(now);
  const to = startOfNextMonthUTC(now);

  const r = await db.execute(sql`
    select count(*)::int as c
    from quote_logs
    where tenant_id = ${tenantId}::uuid
      and created_at >= ${from.toISOString()}::timestamptz
      and created_at < ${to.toISOString()}::timestamptz
  `);

  const count = Number((r as any)?.rows?.[0]?.c ?? 0);

  if (count >= monthlyQuoteLimit) {
    const err: any = new Error("PLAN_LIMIT_REACHED");
    err.code = "PLAN_LIMIT_REACHED";
    err.status = 402;
    err.meta = { used: count, limit: monthlyQuoteLimit };
    throw err;
  }
}

/**
 * Read pricing policy + pricing model from tenant_settings WITHOUT relying on Drizzle schema columns.
 */
async function loadPricingPolicySnapshot(args: { tenantId: string; debug?: DebugFn }): Promise<PricingPolicySnapshot> {
  const { tenantId, debug } = args;

  const r = await db.execute(sql`
    select
      ai_mode,
      pricing_enabled,
      pricing_model
    from tenant_settings
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

  const pricing_enabled = Boolean(row?.pricing_enabled ?? false);
  const ai_mode_raw = safeTrim(row?.ai_mode) || "assessment_only";
  const ai_mode: AiMode = pricing_enabled
    ? (isAiMode(ai_mode_raw) ? (ai_mode_raw as AiMode) : "range")
    : "assessment_only";

  const pricing_model_raw = safeTrim(row?.pricing_model);
  const pricing_model: PricingModel | null =
    pricing_enabled && isPricingModel(pricing_model_raw) ? (pricing_model_raw as PricingModel) : null;

  const normalized = normalizePricingPolicy({ ai_mode, pricing_enabled, pricing_model });
  debug?.("pricingPolicy.loaded", normalized);

  return normalized;
}

/**
 * ✅ Auditable AI snapshot (hash prompts, store key source)
 */
function buildAiSnapshot(args: {
  phase: "phase1_insert" | "phase1_qa_asking" | "phase1_estimated" | "phase2_finalized";
  tenantId: string;
  tenantSlug: string;
  renderOptIn: boolean;
  resolved: any;
  industryKey: string;
  llmKeySource: KeySource;
  pricingPolicy: PricingPolicySnapshot;
}) {
  const { phase, tenantId, tenantSlug, renderOptIn, resolved, industryKey, llmKeySource, pricingPolicy } = args;

  const quoteEstimatorSystem = resolved?.prompts?.quoteEstimatorSystem ?? "";
  const qaQuestionGeneratorSystem = resolved?.prompts?.qaQuestionGeneratorSystem ?? "";

  const policy = normalizePricingPolicy(pricingPolicy);

  return {
    version: 3,
    capturedAt: nowIso(),
    phase,
    tenant: { tenantId, tenantSlug, industryKey },
    models: {
      estimatorModel: resolved.models.estimatorModel,
      qaModel: resolved.models.qaModel,
      renderModel: resolved.models.renderModel,
    },
    prompts: {
      quoteEstimatorSystemSha256: sha256Hex(quoteEstimatorSystem),
      qaQuestionGeneratorSystemSha256: sha256Hex(qaQuestionGeneratorSystem),
      quoteEstimatorSystemLen: quoteEstimatorSystem.length,
      qaQuestionGeneratorSystemLen: qaQuestionGeneratorSystem.length,
    },
    guardrails: resolved.guardrails,
    tenantSettings: {
      ...resolved.tenant,
      renderOptIn,
      llmKeySource,
    },
    pricing: {
      policy,
      modelHint: policy.pricing_enabled ? policy.pricing_model : null,
    },
    pricingPayload: resolved.pricing ?? null,
    meta: resolved.meta ?? null,
  };
}

// ---------------- email helpers ----------------
async function sendFinalEstimateEmails(args: {
  req: Request;
  tenant: { id: string; name: string; slug: string };
  tenantSlug: string;
  quoteLogId: string;
  customer: { name: string; email: string; phone: string };
  notes: string;
  images: Array<{ url: string; shotType?: string }>;
  output: any;
  brandLogoUrl: string | null;
  brandLogoVariant: BrandLogoVariant;
  businessNameFromSettings: string | null;
  renderOptIn: boolean;
}) {
  const {
    req,
    tenant,
    tenantSlug,
    quoteLogId,
    customer,
    notes,
    images,
    output,
    brandLogoUrl,
    brandLogoVariant,
    businessNameFromSettings,
    renderOptIn,
  } = args;

  const cfg = await getTenantEmailConfig(tenant.id);
  const effectiveBusinessName = businessNameFromSettings || cfg.businessName || tenant.name;

  const configured = Boolean(
    process.env.RESEND_API_KEY?.trim() && effectiveBusinessName && cfg.leadToEmail && cfg.fromEmail
  );

  const baseUrl = getBaseUrl(req);
  const adminQuoteUrl = baseUrl ? `${baseUrl}/admin/quotes/${encodeURIComponent(quoteLogId)}` : null;

  const emailResult: any = {
    configured,
    mode: cfg.sendMode ?? "standard",
    lead_new: { attempted: false, ok: false, provider: "resend", id: null as string | null, error: null as string | null },
    customer_receipt: { attempted: false, ok: false, provider: "resend", id: null as string | null, error: null as string | null },
  };

  if (!configured) return emailResult;

  try {
    emailResult.lead_new.attempted = true;

    const leadHtml = renderLeadNewEmailHTML({
      businessName: effectiveBusinessName!,
      tenantSlug,
      quoteLogId,
      customer,
      notes,
      imageUrls: images.map((x) => x.url).filter(Boolean),
      brandLogoUrl,
      brandLogoVariant,
      adminQuoteUrl,
      confidence: output.confidence ?? null,
      inspectionRequired: output.inspection_required ?? null,
      estimateLow: output.estimate_low ?? null,
      estimateHigh: output.estimate_high ?? null,
      summary: output.summary ?? null,
      visibleScope: output.visible_scope ?? [],
      assumptions: output.assumptions ?? [],
      questions: output.questions ?? [],
      renderOptIn: Boolean(renderOptIn),
    } as any);

    const r1 = await sendEmail({
      tenantId: tenant.id,
      context: { type: "lead_new", quoteLogId },
      message: {
        from: cfg.fromEmail!,
        to: [cfg.leadToEmail!],
        replyTo: [cfg.leadToEmail!],
        subject: `New Photo Quote — ${customer.name}`,
        html: leadHtml,
      },
    });

    emailResult.lead_new.ok = r1.ok;
    emailResult.lead_new.id = r1.providerMessageId ?? null;
    emailResult.lead_new.error = r1.error ?? null;
  } catch (e: any) {
    emailResult.lead_new.error = e?.message ?? String(e);
  }

  await sleepMs(650);

  try {
    emailResult.customer_receipt.attempted = true;

    const custHtml = renderCustomerReceiptEmailHTML({
      businessName: effectiveBusinessName!,
      customerName: customer.name,
      summary: output.summary ?? "",
      estimateLow: output.estimate_low ?? 0,
      estimateHigh: output.estimate_high ?? 0,
      confidence: output.confidence ?? null,
      inspectionRequired: output.inspection_required ?? null,
      visibleScope: output.visible_scope ?? [],
      assumptions: output.assumptions ?? [],
      questions: output.questions ?? [],
      imageUrls: images.map((x) => x.url).filter(Boolean),
      brandLogoUrl,
      brandLogoVariant,
      replyToEmail: cfg.leadToEmail ?? null,
      quoteLogId,
    } as any);

    const r2 = await sendEmail({
      tenantId: tenant.id,
      context: { type: "customer_receipt", quoteLogId },
      message: {
        from: cfg.fromEmail!,
        to: [customer.email],
        replyTo: [cfg.leadToEmail!],
        subject: `Your AI Photo Quote — ${effectiveBusinessName}`,
        html: custHtml,
      },
    });

    emailResult.customer_receipt.ok = r2.ok;
    emailResult.customer_receipt.id = r2.providerMessageId ?? null;
    emailResult.customer_receipt.error = r2.error ?? null;
  } catch (e: any) {
    emailResult.customer_receipt.error = e?.message ?? String(e);
  }

  return emailResult;
}

// ----------------- handler -----------------
export async function POST(req: Request) {
  const debugEnabled = isDebugEnabled(req);
  const debugId = debugEnabled ? (crypto.randomUUID?.() || crypto.randomBytes(8).toString("hex")) : null;

  const debug: DebugFn = (stage, data) => {
    if (!debugEnabled) return;
    console.log(
      JSON.stringify({
        tag: "apq_debug",
        debugId,
        stage,
        ts: new Date().toISOString(),
        ...(data || {}),
      })
    );
  };

  try {
    debug("request.start", {
      method: "POST",
      urlPath: (() => {
        try {
          return new URL(req.url).pathname;
        } catch {
          return null;
        }
      })(),
      dbTarget: safeDbTargetFromEnv(),
      hasOpenAiPlatformKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
    });

    const body = await req.json().catch(() => null);
    const parsed = Req.safeParse(body);
    if (!parsed.success) {
      debug("request.invalid_body", { issuesCount: parsed.error.issues?.length ?? 0 });
      return NextResponse.json(
        { ok: false, error: "INVALID_BODY", issues: parsed.error.issues, ...(debugEnabled ? { debugId } : {}) },
        { status: 400 }
      );
    }

    const { tenantSlug } = parsed.data;
    debug("tenantSlug.parsed", { tenantSlug });

    // platform gates
    const pc = await db
      .select({
        aiQuotingEnabled: platformConfig.aiQuotingEnabled,
        maintenanceEnabled: platformConfig.maintenanceEnabled,
        maintenanceMessage: platformConfig.maintenanceMessage,
      })
      .from(platformConfig)
      .limit(1)
      .then((r) => r[0] ?? null);

    debug("platformConfig.loaded", {
      found: Boolean(pc),
      maintenanceEnabled: Boolean(pc?.maintenanceEnabled),
      aiQuotingEnabled: pc?.aiQuotingEnabled ?? null,
    });

    if (pc?.maintenanceEnabled) {
      return NextResponse.json(
        {
          ok: false,
          error: "MAINTENANCE",
          message: pc.maintenanceMessage || "Service temporarily unavailable.",
          ...(debugEnabled ? { debugId } : {}),
        },
        { status: 503 }
      );
    }
    if (pc && pc.aiQuotingEnabled === false) {
      return NextResponse.json(
        { ok: false, error: "AI_DISABLED", message: "AI quoting is currently disabled.", ...(debugEnabled ? { debugId } : {}) },
        { status: 503 }
      );
    }

    // Tenant lookup by slug
    const tenant = await db
      .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.slug, tenantSlug))
      .limit(1)
      .then((r) => r[0] ?? null);

    debug("tenant.lookup", { found: Boolean(tenant), tenantId: tenant?.id ?? null, tenantSlugDb: tenant?.slug ?? null });

    if (!tenant) {
      return NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND", ...(debugEnabled ? { debugId } : {}) }, { status: 404 });
    }

    // Determine phase
    const isPhase2 = Boolean(parsed.data.quoteLogId && parsed.data.qaAnswers?.length);
    debug("phase.detected", {
      isPhase2,
      quoteLogId: parsed.data.quoteLogId ?? null,
      qaAnswersLen: parsed.data.qaAnswers?.length ?? 0,
    });

    // Settings
    const settings = await db
      .select({
        tenantId: tenantSettings.tenantId,
        industryKey: tenantSettings.industryKey,
        brandLogoUrl: tenantSettings.brandLogoUrl,
        brandLogoVariant: (tenantSettings as any).brandLogoVariant,
        businessName: tenantSettings.businessName,
        planTier: tenantSettings.planTier,
        monthlyQuoteLimit: tenantSettings.monthlyQuoteLimit,
        activationGraceCredits: tenantSettings.activationGraceCredits,
        activationGraceUsed: tenantSettings.activationGraceUsed,
        emailSendMode: (tenantSettings as any).emailSendMode,
        resendFromEmail: tenantSettings.resendFromEmail,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenant.id))
      .limit(1)
      .then((r) => r[0] ?? null);

    debug("tenantSettings.lookup", {
      found: Boolean(settings),
      settingsTenantId: settings?.tenantId ?? null,
      industryKey: settings?.industryKey ?? null,
      planTier: settings?.planTier ?? null,
      activationGraceCredits: settings?.activationGraceCredits ?? null,
      activationGraceUsed: settings?.activationGraceUsed ?? null,
      emailSendMode: (settings as any)?.emailSendMode ?? null,
      hasResendFromEmail: Boolean(settings?.resendFromEmail),
    });

    if (!settings) {
      const e: any = new Error("SETTINGS_MISSING");
      e.code = "SETTINGS_MISSING";
      e.status = 500;
      throw e;
    }

    // enforce plan limits on phase 1 only
    if (!isPhase2) {
      const limit = typeof settings.monthlyQuoteLimit === "number" ? settings.monthlyQuoteLimit : null;
      await enforceMonthlyLimit({ tenantId: tenant.id, monthlyQuoteLimit: limit });
    }

    const tenantIndustryKey = safeTrim(settings.industryKey) || "service";
    const brandLogoUrl = safeTrim(settings.brandLogoUrl) || null;
    const brandLogoVariant: BrandLogoVariant = normalizeBrandLogoVariant((settings as any)?.brandLogoVariant);
    const businessNameFromSettings = safeTrim(settings.businessName) || null;

    // Pre-load quote log if phase2 (immutable industry + key source + pricing snapshots)
    let phase2Existing: { id: string; input: any; qa: any; output: any } | null = null;
    let industryKeyForQuote = tenantIndustryKey;
    let phase2KeySource: KeySource | null = null;

    let pricingPolicy: PricingPolicySnapshot | null = null;
    let pricingConfigSnap: PricingConfigSnapshot | null = null;
    let pricingRulesSnap: PricingRulesSnapshot | null = null;

    if (isPhase2) {
      const quoteLogId = parsed.data.quoteLogId!;
      phase2Existing = await db
        .select({ id: quoteLogs.id, input: quoteLogs.input, qa: quoteLogs.qa, output: quoteLogs.output })
        .from(quoteLogs)
        .where(eq(quoteLogs.id, quoteLogId))
        .limit(1)
        .then((r) => r[0] ?? null);

      debug("quoteLog.phase2.lookup", { found: Boolean(phase2Existing), quoteLogId });

      if (!phase2Existing) {
        return NextResponse.json({ ok: false, error: "QUOTE_NOT_FOUND", ...(debugEnabled ? { debugId } : {}) }, { status: 404 });
      }

      const inputAny: any = phase2Existing.input ?? {};
      industryKeyForQuote = pickIndustrySnapshotFromInput(inputAny) || tenantIndustryKey;

      const ks = String(inputAny?.llmKeySource ?? "").trim();
      phase2KeySource = ks === "platform_grace" ? "platform_grace" : ks === "tenant" ? "tenant" : null;

      pricingPolicy = pickPricingPolicyFromInput(inputAny);
      pricingConfigSnap = pickPricingConfigFromInput(inputAny);
      pricingRulesSnap = pickPricingRulesFromInput(inputAny);

      debug("quoteLog.phase2.snapshot", {
        industryKeyForQuote,
        phase2KeySource,
        hasPricingPolicy: Boolean(pricingPolicy),
        hasPricingConfig: Boolean(pricingConfigSnap),
        hasPricingRules: Boolean(pricingRulesSnap),
      });
    } else {
      industryKeyForQuote = tenantIndustryKey;
    }

    // Resolve tenant settings (toggles + pricing payload)
    const resolvedBase = await resolveTenantLlm(tenant.id);

    // Phase1: load policy from DB if not present
    if (!pricingPolicy) pricingPolicy = await loadPricingPolicySnapshot({ tenantId: tenant.id, debug });

    // Phase1: freeze pricing config/rules from resolved payload
    const resolvedPricingConfig = (resolvedBase as any)?.pricing?.config ?? null;
    const resolvedPricingRules = (resolvedBase as any)?.pricing?.rules ?? null;

    // Apply hard gate in phase1
    const pricingEnabledGate = Boolean((resolvedBase as any)?.tenant?.pricingEnabled);

    pricingPolicy = isPhase2
      ? normalizePricingPolicy(pricingPolicy)
      : applyPricingEnabledGate(normalizePricingPolicy(pricingPolicy), pricingEnabledGate);

    // If phase2 did not have snapshots, fall back
    if (!pricingConfigSnap) pricingConfigSnap = resolvedPricingConfig;
    if (!pricingRulesSnap) pricingRulesSnap = resolvedPricingRules;

    // ✅ Strict isolation: build LLM context (includes OpenAI client, composed prompts, models)
    const llm = await buildLlmContext({
      tenantId: tenant.id,
      industryKey: industryKeyForQuote,
      pricingPolicy,
      isPhase2,
      forceKeySource: isPhase2 ? phase2KeySource : null,
      debug,
    });

    const resolved = {
      ...resolvedBase,
      models: llm.models,
      guardrails: llm.guardrails,
      prompts: llm.prompts,
      meta: {
        ...(resolvedBase as any)?.meta,
        compositionVersion: llm.meta.compositionVersion,
        industryPromptPackApplied: llm.meta.industryPromptPackApplied,
        industryKeyApplied: llm.meta.industryKeyApplied,
      },
    };

    debug("pcc.resolved", {
      industryKeyForQuote,
      industryPromptPackApplied: (resolved as any)?.meta?.industryPromptPackApplied ?? null,
      compositionVersion: (resolved as any)?.meta?.compositionVersion ?? null,
      liveQaEnabled: Boolean(resolved?.tenant?.liveQaEnabled),
      liveQaMaxQuestions: resolved?.tenant?.liveQaMaxQuestions ?? null,
      tenantRenderEnabled: Boolean(resolved?.tenant?.tenantRenderEnabled),
      pricingEnabledGate,
      pricingPolicy,
      hasPricingConfigSnap: Boolean(pricingConfigSnap),
      hasPricingRulesSnap: Boolean(pricingRulesSnap),
      llmKeySource: llm.keySource,
    });

    const denylist = resolved.guardrails.blockedTopics ?? [];

    const aiEnvelope = {
      liveQaEnabled: resolved.tenant.liveQaEnabled,
      liveQaMaxQuestions: resolved.tenant.liveQaMaxQuestions,
      tenantRenderEnabled: resolved.tenant.tenantRenderEnabled,
      renderOptIn: undefined as boolean | undefined,
      tenantStyleKey: resolved.tenant.tenantStyleKey ?? undefined,
      tenantRenderNotes: resolved.tenant.tenantRenderNotes ?? undefined,
      industryKey: industryKeyForQuote,
      industryPromptPackApplied: (resolved as any)?.meta?.industryPromptPackApplied ?? undefined,
      llmKeySource: llm.keySource,
      pricingPolicy,
    };

    // -------------------------
    // Phase 2: finalize after QA
    // -------------------------
    if (isPhase2) {
      const quoteLogId = parsed.data.quoteLogId!;
      const existing = phase2Existing!;
      const inputAny: any = existing.input ?? {};

      const images = Array.isArray(inputAny.images) ? inputAny.images : [];
      const customer = inputAny.customer ?? null;

      const customer_context = inputAny.customer_context ?? {};
      const category = safeTrim(customer_context.category) || industryKeyForQuote || "service";
      const service_type = safeTrim(customer_context.service_type) || "upholstery";
      const notes = safeTrim(customer_context.notes) || "";

      if (!customer?.name || !customer?.email || !customer?.phone) {
        return NextResponse.json(
          { ok: false, error: "MISSING_CUSTOMER_IN_LOG", ...(debugEnabled ? { debugId } : {}) },
          { status: 400 }
        );
      }

      const qaStored: any = existing.qa ?? {};
      const storedQuestions: string[] = Array.isArray(qaStored?.questions)
        ? qaStored.questions.map((x: unknown) => String(x)).filter(Boolean)
        : [];

      let normalizedAnswers: Array<{ question: string; answer: string }> = [];

      if (Array.isArray(parsed.data.qaAnswers) && typeof (parsed.data.qaAnswers as any)[0] === "string") {
        const answersOnly = (parsed.data.qaAnswers as string[]).map((s) => String(s ?? "").trim());
        normalizedAnswers = answersOnly.map((ans, i) => ({
          question: storedQuestions[i] ?? `Question ${i + 1}`,
          answer: ans,
        }));
      } else {
        normalizedAnswers = (parsed.data.qaAnswers as Array<any>).map((x) => ({
          question: String(x?.question ?? "").trim(),
          answer: String(x?.answer ?? "").trim(),
        }));
      }

      if (storedQuestions.length) normalizedAnswers = normalizedAnswers.slice(0, storedQuestions.length);

      const qaPayload = {
        ...(qaStored ?? {}),
        questions: storedQuestions,
        answers: normalizedAnswers,
        answeredAt: nowIso(),
      };

      await db
        .update(quoteLogs)
        .set({
          qa: qaPayload as any,
          qaStatus: "answered",
          qaAnsweredAt: new Date(),
        })
        .where(eq(quoteLogs.id, quoteLogId));

      if (denylist.length) {
        const combined = normalizedAnswers.map((x) => `${x.question}\n${x.answer}`).join("\n\n");
        if (containsDenylistedText(combined, denylist)) {
          return NextResponse.json(
            { ok: false, error: "CONTENT_BLOCKED", message: "Your answers include content we can’t process. Please revise.", ...(debugEnabled ? { debugId } : {}) },
            { status: 400 }
          );
        }
      }

      const renderOptIn = Boolean(inputAny?.render_opt_in);
      aiEnvelope.renderOptIn = renderOptIn;

      const aiSnapshot = buildAiSnapshot({
        phase: "phase2_finalized",
        tenantId: tenant.id,
        tenantSlug,
        renderOptIn,
        resolved,
        industryKey: industryKeyForQuote,
        llmKeySource: (phase2KeySource ?? llm.keySource) as KeySource,
        pricingPolicy,
      });

      // ✅ LLM call is isolated
      const rawOutput = await llm.generateEstimate({
        images,
        category,
        service_type,
        notes,
        normalizedAnswers,
        debug,
      });

      // ✅ SERVER-SIDE PRICING (deterministic)
      const computed = computeEstimate({
        ai: rawOutput,
        imagesCount: Array.isArray(images) ? images.length : 0,
        policy: pricingPolicy,
        config: pricingConfigSnap,
        rules: pricingRulesSnap,
      });

      const shaped = applyAiModeToEstimates(pricingPolicy, {
        estimate_low: computed.estimate_low,
        estimate_high: computed.estimate_high,
      });

      const output = {
        ...rawOutput,
        inspection_required: computed.inspection_required,
        estimate_low: shaped.estimate_low,
        estimate_high: shaped.estimate_high,
        pricing_basis: computed.basis,
      };

      let outputToStore: any = { ...(output ?? {}), ai_snapshot: aiSnapshot };

      await db.execute(sql`
        update quote_logs
        set output = ${JSON.stringify(outputToStore)}::jsonb
        where id = ${quoteLogId}::uuid
      `);

      try {
        const emailResult = await sendFinalEstimateEmails({
          req,
          tenant: { id: tenant.id, name: tenant.name ?? "Business", slug: tenant.slug },
          tenantSlug,
          quoteLogId,
          customer,
          notes,
          images,
          output,
          brandLogoUrl,
          brandLogoVariant,
          businessNameFromSettings,
          renderOptIn,
        });

        outputToStore = { ...(outputToStore ?? {}), email: emailResult };

        await db.execute(sql`
          update quote_logs
          set output = ${JSON.stringify(outputToStore)}::jsonb
          where id = ${quoteLogId}::uuid
        `);
      } catch (e: any) {
        outputToStore = { ...(outputToStore ?? {}), email: { configured: false, error: e?.message ?? String(e) } };
      }

      return NextResponse.json({ ok: true, quoteLogId, output: outputToStore, ai: aiEnvelope, ...(debugEnabled ? { debugId } : {}) });
    }

    // -------------------------
    // Phase 1: initial submission
    // -------------------------
    const images = parsed.data.images ?? [];

    const incoming = parsed.data.customer ?? parsed.data.contact;
    if (!incoming) {
      return NextResponse.json(
        { ok: false, error: "MISSING_CUSTOMER", message: "Customer info is required (name, phone, email).", ...(debugEnabled ? { debugId } : {}) },
        { status: 400 }
      );
    }

    const customer = {
      name: safeTrim(incoming.name),
      phone: normalizePhone(incoming.phone),
      email: safeTrim(incoming.email).toLowerCase(),
    };

    if (customer.phone.replace(/\D/g, "").length < 10) {
      return NextResponse.json(
        { ok: false, error: "INVALID_PHONE", message: "Phone must include at least 10 digits.", ...(debugEnabled ? { debugId } : {}) },
        { status: 400 }
      );
    }

    if (!images.length) {
      return NextResponse.json(
        { ok: false, error: "MISSING_IMAGES", message: "At least 1 image is required.", ...(debugEnabled ? { debugId } : {}) },
        { status: 400 }
      );
    }

    const customer_context = parsed.data.customer_context ?? {};

    const category = industryKeyForQuote || "service";
    const service_type = safeTrim(customer_context.service_type) || "upholstery";
    const notes = safeTrim(customer_context.notes) || "";

    if (denylist.length && containsDenylistedText(notes, denylist)) {
      return NextResponse.json(
        { ok: false, error: "CONTENT_BLOCKED", message: "Your request includes content we can’t process. Please revise and try again.", ...(debugEnabled ? { debugId } : {}) },
        { status: 400 }
      );
    }

    const renderOptIn = resolved.tenant.tenantRenderEnabled ? Boolean(parsed.data.render_opt_in) : false;
    aiEnvelope.renderOptIn = renderOptIn;

    // ✅ Freeze pricing policy + pricing inputs into the quote log so phase2 is immutable
    const policyToStore = applyPricingEnabledGate(pricingPolicy, Boolean(resolved.tenant.pricingEnabled));

    const pricing_config_snapshot: PricingConfigSnapshot | null = (resolved as any)?.pricing?.config ?? null;
    const pricing_rules_snapshot: PricingRulesSnapshot | null = (resolved as any)?.pricing?.rules ?? null;

    const inputToStore = {
      tenantSlug,
      images,
      render_opt_in: renderOptIn,
      customer,
      industryKeySnapshot: industryKeyForQuote,
      industrySource: "tenant_settings" as const,
      llmKeySource: llm.keySource,
      customer_context: { category, service_type, notes },

      pricing_policy_snapshot: policyToStore,
      pricing_config_snapshot,
      pricing_rules_snapshot,

      // back-compat fields (keep)
      pricing_model_snapshot: policyToStore.pricing_enabled ? policyToStore.pricing_model ?? null : null,
      ai_mode_snapshot: policyToStore.ai_mode,
      pricing_enabled_snapshot: policyToStore.pricing_enabled,

      createdAt: nowIso(),
    };

    const aiSnapshotInsert = buildAiSnapshot({
      phase: "phase1_insert",
      tenantId: tenant.id,
      tenantSlug,
      renderOptIn,
      resolved,
      industryKey: industryKeyForQuote,
      llmKeySource: llm.keySource,
      pricingPolicy: policyToStore,
    });

    const inserted = await db
      .insert(quoteLogs)
      .values({
        tenantId: tenant.id,
        input: inputToStore,
        output: { ai_snapshot: aiSnapshotInsert } as any,
        renderOptIn,
        qaStatus: "none",
      })
      .returning({ id: quoteLogs.id })
      .then((r) => r[0] ?? null);

    const quoteLogId = inserted?.id ? String(inserted.id) : null;
    if (!quoteLogId) {
      return NextResponse.json({ ok: false, error: "FAILED_TO_CREATE_QUOTE", ...(debugEnabled ? { debugId } : {}) }, { status: 500 });
    }

    if (resolved.tenant.liveQaEnabled && resolved.tenant.liveQaMaxQuestions > 0) {
      // ✅ LLM call is isolated
      const questions = await llm.generateQaQuestions({
        images,
        category,
        service_type,
        notes,
        maxQuestions: resolved.tenant.liveQaMaxQuestions,
        debug,
      });

      const qa = { questions, answers: [], askedAt: nowIso() };

      const aiSnapshotAsking = buildAiSnapshot({
        phase: "phase1_qa_asking",
        tenantId: tenant.id,
        tenantSlug,
        renderOptIn,
        resolved,
        industryKey: industryKeyForQuote,
        llmKeySource: llm.keySource,
        pricingPolicy: policyToStore,
      });

      await db
        .update(quoteLogs)
        .set({
          qa: qa as any,
          qaStatus: "asking",
          qaAskedAt: new Date(),
          output: { ai_snapshot: aiSnapshotAsking } as any,
        })
        .where(eq(quoteLogs.id, quoteLogId));

      return NextResponse.json({ ok: true, quoteLogId, needsQa: true, questions, qa, ai: aiEnvelope, ...(debugEnabled ? { debugId } : {}) });
    }

    // ✅ LLM call is isolated
    const rawOutput = await llm.generateEstimate({
      images,
      category,
      service_type,
      notes,
      debug,
    });

    // ✅ SERVER-SIDE PRICING (deterministic)
    const computed = computeEstimate({
      ai: rawOutput,
      imagesCount: Array.isArray(images) ? images.length : 0,
      policy: policyToStore,
      config: pricing_config_snapshot,
      rules: pricing_rules_snapshot,
    });

    const shaped = applyAiModeToEstimates(policyToStore, {
      estimate_low: computed.estimate_low,
      estimate_high: computed.estimate_high,
    });

    const output = {
      ...rawOutput,
      inspection_required: computed.inspection_required,
      estimate_low: shaped.estimate_low,
      estimate_high: shaped.estimate_high,
      pricing_basis: computed.basis,
    };

    const aiSnapshotEstimated = buildAiSnapshot({
      phase: "phase1_estimated",
      tenantId: tenant.id,
      tenantSlug,
      renderOptIn,
      resolved,
      industryKey: industryKeyForQuote,
      llmKeySource: llm.keySource,
      pricingPolicy: policyToStore,
    });

    let outputToStore: any = { ...(output ?? {}), ai_snapshot: aiSnapshotEstimated };

    await db.execute(sql`
      update quote_logs
      set output = ${JSON.stringify(outputToStore)}::jsonb
      where id = ${quoteLogId}::uuid
    `);

    try {
      const emailResult = await sendFinalEstimateEmails({
        req,
        tenant: { id: tenant.id, name: tenant.name ?? "Business", slug: tenant.slug },
        tenantSlug,
        quoteLogId,
        customer,
        notes,
        images,
        output,
        brandLogoUrl,
        brandLogoVariant,
        businessNameFromSettings,
        renderOptIn,
      });

      outputToStore = { ...(outputToStore ?? {}), email: emailResult };

      await db.execute(sql`
        update quote_logs
        set output = ${JSON.stringify(outputToStore)}::jsonb
        where id = ${quoteLogId}::uuid
      `);
    } catch (e: any) {
      outputToStore = { ...(outputToStore ?? {}), email: { configured: false, error: e?.message ?? String(e) } };
    }

    return NextResponse.json({ ok: true, quoteLogId, output: outputToStore, ai: aiEnvelope, ...(debugEnabled ? { debugId } : {}) });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const code = e?.code || msg;

    if (debugEnabled) {
      console.log(
        JSON.stringify({
          tag: "apq_debug",
          debugId,
          stage: "request.error",
          ts: new Date().toISOString(),
          code: code ?? null,
          message: msg ?? null,
        })
      );
    }

    if (code === "PLAN_LIMIT_REACHED") {
      return NextResponse.json(
        { ok: false, error: "PLAN_LIMIT_REACHED", message: "Monthly quote limit reached for your plan.", meta: e?.meta ?? undefined, ...(debugEnabled ? { debugId } : {}) },
        { status: 402 }
      );
    }

    if (code === "TRIAL_EXHAUSTED") {
      return NextResponse.json(
        {
          ok: false,
          error: "TRIAL_EXHAUSTED",
          message: "Trial credits exhausted. Add your OpenAI key in Settings (AI Setup) or upgrade your plan.",
          meta: e?.meta ?? undefined,
          ...(debugEnabled ? { debugId } : {}),
        },
        { status: 402 }
      );
    }

    if (code === "MISSING_PLATFORM_OPENAI_KEY") {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_PLATFORM_OPENAI_KEY",
          message: "Platform OpenAI key is not configured. Set OPENAI_API_KEY in Vercel environment variables.",
          ...(debugEnabled ? { debugId } : {}),
        },
        { status: 500 }
      );
    }

    if (code === "MISSING_OPENAI_KEY") {
      return NextResponse.json(
        { ok: false, error: "MISSING_OPENAI_KEY", message: "No OpenAI key is configured for this tenant. Add a tenant key in AI Setup.", ...(debugEnabled ? { debugId } : {}) },
        { status: 400 }
      );
    }

    if (code === "SETTINGS_MISSING") {
      return NextResponse.json(
        { ok: false, error: "SETTINGS_MISSING", message: "Tenant settings could not be loaded. See debugId in logs.", ...(debugEnabled ? { debugId } : {}) },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg, ...(debugEnabled ? { debugId } : {}) }, { status: 500 });
  }
}