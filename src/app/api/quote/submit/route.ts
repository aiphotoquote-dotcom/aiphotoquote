// src/app/api/quote/submit/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import OpenAI from "openai";
import crypto from "crypto";

import { db } from "@/lib/db/client";
import { tenants, tenantSecrets, tenantSettings, quoteLogs, platformConfig } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

import { sendEmail } from "@/lib/email";
import { getTenantEmailConfig } from "@/lib/email/tenantEmail";
import { renderLeadNewEmailHTML } from "@/lib/email/templates/leadNew";
import { renderCustomerReceiptEmailHTML } from "@/lib/email/templates/customerReceipt";

import { resolveTenantLlm } from "@/lib/pcc/llm/resolveTenant";
import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";
import { resolvePromptsForIndustry } from "@/lib/pcc/llm/resolvePrompts";

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

const AiOutputSchema = z.object({
  confidence: z.enum(["high", "medium", "low"]),
  inspection_required: z.boolean(),
  estimate_low: z.number().nonnegative(),
  estimate_high: z.number().nonnegative(),
  currency: z.string().default("USD"),
  summary: z.string(),
  visible_scope: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  questions: z.array(z.string()).default([]),
});

const QaQuestionsSchema = z.object({
  questions: z.array(z.string().min(1)).min(1),
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

type PricingPolicySnapshot = {
  ai_mode: AiMode;
  pricing_enabled: boolean;
  pricing_model: PricingModel | null;
};

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
  // pricing enabled: keep ai_mode (default to range if invalid upstream)
  const ai_mode: AiMode = isAiMode(pp.ai_mode) ? pp.ai_mode : "range";
  const pricing_model = pp.pricing_model ?? null;
  return { ai_mode, pricing_enabled: true, pricing_model };
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

  // back-compat: allow separate fields
  const ai_mode_raw = safeTrim(inputAny?.ai_mode_snapshot);
  const pricing_enabled_raw = inputAny?.pricing_enabled_snapshot;
  const pricing_model_raw = safeTrim(inputAny?.pricing_model_snapshot);

  const ai_mode: AiMode = isAiMode(ai_mode_raw) ? (ai_mode_raw as AiMode) : "assessment_only";
  const pricing_enabled = typeof pricing_enabled_raw === "boolean" ? pricing_enabled_raw : Boolean(pricing_enabled_raw);
  const pricing_model = isPricingModel(pricing_model_raw) ? (pricing_model_raw as PricingModel) : null;

  return normalizePricingPolicy({ ai_mode, pricing_enabled, pricing_model });
}

function startOfMonthUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}
function startOfNextMonthUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

type KeySource = "tenant" | "platform_grace";

function platformOpenAiKey(): string | null {
  // per your note: Vercel uses OPENAI_API_KEY
  const k = process.env.OPENAI_API_KEY?.trim() || "";
  return k ? k : null;
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
 * (Keeps this branch safe even if schema typings lag behind DB.)
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

  // If pricing is disabled, force assessment-only (your rule)
  const ai_mode_raw = safeTrim(row?.ai_mode) || "assessment_only";
  const ai_mode: AiMode = pricing_enabled ? (isAiMode(ai_mode_raw) ? (ai_mode_raw as AiMode) : "range") : "assessment_only";

  const pricing_model_raw = safeTrim(row?.pricing_model);
  const pricing_model: PricingModel | null =
    pricing_enabled && isPricingModel(pricing_model_raw) ? (pricing_model_raw as PricingModel) : null;

  const normalized = normalizePricingPolicy({ ai_mode, pricing_enabled, pricing_model });

  debug?.("pricingPolicy.loaded", normalized);

  return normalized;
}

/**
 * Hard guardrail: enforce policy on output *even if the model misbehaves*.
 */
function enforcePricingPolicyOnOutput(output: any, policy: PricingPolicySnapshot) {
  const p = normalizePricingPolicy(policy);
  const ai_mode = p.ai_mode;
  const pricing_enabled = p.pricing_enabled;

  let { low, high } = ensureLowHigh(Number(output?.estimate_low ?? 0), Number(output?.estimate_high ?? 0));

  // If pricing is disabled OR assessment-only => never show numbers.
  if (!pricing_enabled || ai_mode === "assessment_only") {
    low = 0;
    high = 0;
  } else if (ai_mode === "fixed") {
    // collapse to a single value
    const mid = clampMoney((low + high) / 2);
    low = mid;
    high = mid;
  }

  return { ...output, estimate_low: low, estimate_high: high };
}

/**
 * Prompt-level guardrail: inject policy + pricing model guidance ahead of system prompt.
 * IMPORTANT: Only mention pricing_model hints if pricing_enabled is true.
 */
function wrapEstimatorSystemWithPricingPolicy(baseSystem: string, policy: PricingPolicySnapshot) {
  const p = normalizePricingPolicy(policy);
  const { ai_mode, pricing_enabled, pricing_model } = p;

  const policyBlock = [
    "### POLICY (must follow exactly)",
    "- You are generating a photo-based quote response in a fixed JSON schema.",
    pricing_enabled
      ? "- Pricing is ENABLED."
      : "- Pricing is DISABLED. Do not output any price numbers. Set estimate_low=0 and estimate_high=0.",
    ai_mode === "assessment_only"
      ? "- AI mode is ASSESSMENT ONLY. Do not output any price numbers. Set estimate_low=0 and estimate_high=0."
      : ai_mode === "fixed"
        ? "- AI mode is FIXED ESTIMATE. Output a single-number estimate by setting estimate_low == estimate_high."
        : "- AI mode is RANGE. Output a low/high range.",
    "- If you are unsure, prefer inspection_required=true and keep estimates conservative.",
    "",
  ].join("\n");

  if (!pricing_enabled) {
    return [policyBlock, baseSystem].join("\n");
  }

  const modelHint =
    pricing_model === "flat_per_job"
      ? "Pricing methodology hint: think a single job total. Consider labor+materials+overhead bundled."
      : pricing_model === "hourly_plus_materials"
        ? "Pricing methodology hint: think hours and material costs/markup; range often reflects uncertainty in time/material."
        : pricing_model === "per_unit"
          ? "Pricing methodology hint: estimate per-unit (sq ft/linear ft/per item) and multiply; uncertainty comes from size/count."
          : pricing_model === "packages"
            ? "Pricing methodology hint: think Basic/Standard/Premium tiers; map condition/scope to a tier range."
            : pricing_model === "line_items"
              ? "Pricing methodology hint: think add-ons; base service + optional items; range reflects which items apply."
              : pricing_model === "inspection_only"
                ? "Pricing methodology hint: prefer inspection_required=true; keep low/high conservative and emphasize inspection."
                : pricing_model === "assessment_fee"
                  ? "Pricing methodology hint: assessment/diagnostic fee model; keep estimate conservative and call out assessment if relevant."
                  : "";

  const combined = [policyBlock, modelHint ? `### PRICING MODEL NOTES\n${modelHint}\n` : "", baseSystem].join("\n");
  return combined;
}

/**
 * Resolve OpenAI client using:
 * - tenant secret if present
 * - else platform key if grace credits available (optionally consumes one)
 *
 * IMPORTANT:
 * - Phase 1: consumeGrace=true (atomic increment)
 * - Phase 2: consumeGrace=false (use prior llmKeySource from quote log)
 */
async function resolveOpenAiClient(args: {
  tenantId: string;
  consumeGrace: boolean;
  forceKeySource?: KeySource | null;
  debug?: DebugFn;
}): Promise<{ openai: OpenAI; keySource: KeySource }> {
  const { tenantId, consumeGrace, forceKeySource, debug } = args;

  debug?.("resolveOpenAiClient.start", { tenantId, consumeGrace, forceKeySource: forceKeySource ?? null });

  // 1) Tenant key if exists (unless explicitly forced to platform)
  if (!forceKeySource || forceKeySource === "tenant") {
    const secretRow = await db
      .select({ openaiKeyEnc: tenantSecrets.openaiKeyEnc })
      .from(tenantSecrets)
      .where(eq(tenantSecrets.tenantId, tenantId))
      .limit(1)
      .then((r) => r[0] ?? null);

    debug?.("resolveOpenAiClient.tenantSecret.lookup", { hasTenantSecret: Boolean(secretRow?.openaiKeyEnc) });

    if (secretRow?.openaiKeyEnc) {
      const openaiKey = decryptSecret(secretRow.openaiKeyEnc);
      debug?.("resolveOpenAiClient.tenantSecret.use", { keySource: "tenant" });
      return { openai: new OpenAI({ apiKey: openaiKey }), keySource: "tenant" };
    }

    if (forceKeySource === "tenant") {
      const e: any = new Error("MISSING_OPENAI_KEY");
      e.code = "MISSING_OPENAI_KEY";
      throw e;
    }
  }

  // 2) Platform grace key
  const platformKey = platformOpenAiKey();
  debug?.("resolveOpenAiClient.platformKey.present", { hasPlatformKey: Boolean(platformKey) });

  if (!platformKey) {
    const e: any = new Error("MISSING_PLATFORM_OPENAI_KEY");
    e.code = "MISSING_PLATFORM_OPENAI_KEY";
    throw e;
  }

  // Phase 2 finalize: do NOT consume; honor phase1’s decision
  if (!consumeGrace) {
    debug?.("resolveOpenAiClient.platformGrace.noConsume", { keySource: "platform_grace" });
    return { openai: new OpenAI({ apiKey: platformKey }), keySource: "platform_grace" };
  }

  // ✅ FIX B: Use Drizzle update/select (consistent result shape; avoids db.execute RETURNING row parsing issues)
  const updated = await db
    .update(tenantSettings)
    .set({
      activationGraceUsed: sql`coalesce(${tenantSettings.activationGraceUsed}, 0) + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tenantSettings.tenantId, tenantId),
        sql`coalesce(${tenantSettings.activationGraceUsed}, 0) < coalesce(${tenantSettings.activationGraceCredits}, 0)`
      )
    )
    .returning({
      activation_grace_used: sql`coalesce(${tenantSettings.activationGraceUsed}, 0)`,
      activation_grace_credits: sql`coalesce(${tenantSettings.activationGraceCredits}, 0)`,
    });

  const row = updated?.[0] ?? null;

  debug?.("resolveOpenAiClient.grace.updateResult", {
    updatedRowReturned: Boolean(row),
    activation_grace_used: row?.activation_grace_used ?? null,
    activation_grace_credits: row?.activation_grace_credits ?? null,
  });

  if (!row) {
    const cur = await db
      .select({
        used: sql`coalesce(${tenantSettings.activationGraceUsed}, 0)`,
        credits: sql`coalesce(${tenantSettings.activationGraceCredits}, 0)`,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId))
      .limit(1);

    const curRow = cur?.[0] ?? null;

    debug?.("resolveOpenAiClient.grace.current", {
      hasRow: Boolean(curRow),
      used: curRow?.used ?? null,
      credits: curRow?.credits ?? null,
    });

    if (!curRow) {
      const e: any = new Error("SETTINGS_MISSING");
      e.code = "SETTINGS_MISSING";
      e.status = 400;
      throw e;
    }

    const used = Number(curRow.used ?? 0);
    const credits = Number(curRow.credits ?? 0);

    const e: any = new Error("TRIAL_EXHAUSTED");
    e.code = "TRIAL_EXHAUSTED";
    e.status = 402;
    e.meta = { used, credits };
    throw e;
  }

  debug?.("resolveOpenAiClient.platformGrace.consumeOk", { keySource: "platform_grace" });
  return { openai: new OpenAI({ apiKey: platformKey }), keySource: "platform_grace" };
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
    version: 2,
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
      // Only store model hint when enabled (your rule)
      modelHint: policy.pricing_enabled ? policy.pricing_model : null,
    },
    pricingRules: resolved.pricing ?? null,
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

  const configured = Boolean(process.env.RESEND_API_KEY?.trim() && effectiveBusinessName && cfg.leadToEmail && cfg.fromEmail);

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

// ---------------- AI generation helpers ----------------
async function generateQaQuestions(args: {
  openai: OpenAI;
  model: string;
  system: string;
  images: Array<{ url: string; shotType?: string }>;
  category: string;
  service_type: string;
  notes: string;
  maxQuestions: number;
}) {
  const { openai, model, system, images, category, service_type, notes, maxQuestions } = args;

  const userText = [
    `Category: ${category}`,
    `Service type: ${service_type}`,
    `Customer notes: ${notes || "(none)"}`,
    "",
    `Generate up to ${maxQuestions} questions.`,
  ].join("\n");

  const content: any[] = [{ type: "text", text: userText }];
  for (const img of images) {
    if (img?.url) content.push({ type: "image_url", image_url: { url: img.url } });
  }

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content },
    ],
    temperature: 0.2,
  });

  const raw = completion.choices?.[0]?.message?.content ?? "{}";

  let parsedQa: any = null;
  try {
    parsedQa = JSON.parse(raw);
  } catch {
    parsedQa = null;
  }

  const safeQa = QaQuestionsSchema.safeParse(parsedQa);
  const questions = safeQa.success
    ? safeQa.data.questions.slice(0, maxQuestions)
    : ["Can you describe what you want done (repair vs full replacement) and any material preference?"];

  return questions.map((q) => String(q).trim()).filter(Boolean).slice(0, maxQuestions);
}

async function generateEstimate(args: {
  openai: OpenAI;
  model: string;
  system: string;
  images: Array<{ url: string; shotType?: string }>;
  category: string;
  service_type: string;
  notes: string;
  normalizedAnswers?: Array<{ question: string; answer: string }>;
}) {
  const { openai, model, system, images, category, service_type, notes, normalizedAnswers } = args;

  const qaText = normalizedAnswers?.length ? normalizedAnswers.map((x) => `Q: ${x.question}\nA: ${x.answer}`).join("\n\n") : "";

  const userText = [
    `Category: ${category}`,
    `Service type: ${service_type}`,
    `Customer notes: ${notes || "(none)"}`,
    normalizedAnswers?.length ? "Follow-up Q&A:" : "",
    normalizedAnswers?.length ? (qaText || "(none)") : "",
    "",
    "Instructions:",
    "- Use the photos to identify the item, material type, and visible damage/wear.",
    "- Provide estimate_low and estimate_high (whole dollars).",
    "- Provide visible_scope as short bullet-style strings.",
    "- Provide assumptions and questions (3–8 items each is fine).",
  ]
    .filter((x) => x !== "")
    .join("\n");

  const content: any[] = [{ type: "text", text: userText }];
  for (const img of images) {
    if (img?.url) content.push({ type: "image_url", image_url: { url: img.url } });
  }

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content },
    ],
    temperature: 0.2,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "quote_estimate",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            inspection_required: { type: "boolean" },
            estimate_low: { type: "number" },
            estimate_high: { type: "number" },
            currency: { type: "string" },
            summary: { type: "string" },
            visible_scope: { type: "array", items: { type: "string" } },
            assumptions: { type: "array", items: { type: "string" } },
            questions: { type: "array", items: { type: "string" } },
          },
          required: ["confidence", "inspection_required", "estimate_low", "estimate_high", "summary", "visible_scope", "assumptions", "questions"],
        },
      },
    } as any,
  });

  const raw = completion.choices?.[0]?.message?.content ?? "{}";

  let outputParsed: any = null;
  try {
    outputParsed = JSON.parse(raw);
  } catch {
    outputParsed = null;
  }

  const safe = AiOutputSchema.safeParse(outputParsed);
  if (!safe.success) {
    return {
      confidence: "low",
      inspection_required: true,
      estimate_low: 0,
      estimate_high: 0,
      currency: "USD",
      summary: "We couldn't generate a structured estimate from the submission. Please add 2–6 clear photos and any details you can.",
      visible_scope: [],
      assumptions: [],
      questions: ["Can you add a wide shot and 1–2 close-ups of the problem area?"],
      _raw: raw,
    };
  }

  const v = safe.data;
  const { low, high } = ensureLowHigh(v.estimate_low, v.estimate_high);
  return {
    confidence: v.confidence,
    inspection_required: Boolean(v.inspection_required),
    estimate_low: low,
    estimate_high: high,
    currency: v.currency || "USD",
    summary: String(v.summary || "").trim(),
    visible_scope: Array.isArray(v.visible_scope) ? v.visible_scope : [],
    assumptions: Array.isArray(v.assumptions) ? v.assumptions : [],
    questions: Array.isArray(v.questions) ? v.questions : [],
  };
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
      hasOpenAiPlatformKey: Boolean(platformOpenAiKey()),
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
        { ok: false, error: "MAINTENANCE", message: pc.maintenanceMessage || "Service temporarily unavailable.", ...(debugEnabled ? { debugId } : {}) },
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

    // Settings (existing select used elsewhere)
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

    // Pre-load quote log if phase2 (immutable industry + key source + pricing policy)
    let phase2Existing: { id: string; input: any; qa: any; output: any } | null = null;
    let industryKeyForQuote = tenantIndustryKey;
    let phase2KeySource: KeySource | null = null;
    let pricingPolicy: PricingPolicySnapshot | null = null;

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

      // ✅ freeze pricing policy for phase2 from the log
      pricingPolicy = pickPricingPolicyFromInput(inputAny);

      debug("quoteLog.phase2.snapshot", { industryKeyForQuote, phase2KeySource, hasPricingPolicy: Boolean(pricingPolicy) });
    } else {
      industryKeyForQuote = tenantIndustryKey;
    }

    // ✅ If we didn't get pricing policy from log (phase1), load it from tenant_settings
    if (!pricingPolicy) {
      pricingPolicy = await loadPricingPolicySnapshot({ tenantId: tenant.id, debug });
    }
    pricingPolicy = normalizePricingPolicy(pricingPolicy);

    // Resolve tenant + PCC AI settings
    const resolvedBase = await resolveTenantLlm(tenant.id);
    const pccCfg = await loadPlatformLlmConfig();
    const industryResolved = resolvePromptsForIndustry(pccCfg, industryKeyForQuote);

    const baseEstimator = String(pccCfg?.prompts?.quoteEstimatorSystem ?? "");
    const baseQa = String(pccCfg?.prompts?.qaQuestionGeneratorSystem ?? "");
    const resolvedEstimator = String(resolvedBase?.prompts?.quoteEstimatorSystem ?? "");
    const resolvedQa = String(resolvedBase?.prompts?.qaQuestionGeneratorSystem ?? "");

    const isUsingBaseEstimator = resolvedEstimator.trim() === baseEstimator.trim();
    const isUsingBaseQa = resolvedQa.trim() === baseQa.trim();

    const effectivePrompts = {
      quoteEstimatorSystem:
        isUsingBaseEstimator && industryResolved.quoteEstimatorSystem ? industryResolved.quoteEstimatorSystem : resolvedEstimator,
      qaQuestionGeneratorSystem:
        isUsingBaseQa && industryResolved.qaQuestionGeneratorSystem ? industryResolved.qaQuestionGeneratorSystem : resolvedQa,
    };

    // ✅ Apply pricing-policy wrapper to estimator system prompt
    const estimatorSystemWithPolicy = wrapEstimatorSystemWithPricingPolicy(effectivePrompts.quoteEstimatorSystem, pricingPolicy);

    const resolved = {
      ...resolvedBase,
      prompts: {
        ...resolvedBase.prompts,
        quoteEstimatorSystem: estimatorSystemWithPolicy,
        qaQuestionGeneratorSystem: effectivePrompts.qaQuestionGeneratorSystem,
      },
      meta: {
        ...(resolvedBase as any)?.meta,
        industryPromptPackApplied: {
          industryKey: industryKeyForQuote,
          estimatorApplied: Boolean(isUsingBaseEstimator && industryResolved.quoteEstimatorSystem),
          qaApplied: Boolean(isUsingBaseQa && industryResolved.qaQuestionGeneratorSystem),
        },
      },
    };

    debug("pcc.resolved", {
      industryKeyForQuote,
      industryPromptPackApplied: (resolved as any)?.meta?.industryPromptPackApplied ?? null,
      liveQaEnabled: Boolean(resolved?.tenant?.liveQaEnabled),
      liveQaMaxQuestions: resolved?.tenant?.liveQaMaxQuestions ?? null,
      tenantRenderEnabled: Boolean(resolved?.tenant?.tenantRenderEnabled),
      pricingPolicy,
    });

    const denylist = resolved.guardrails.blockedTopics ?? [];

    // Resolve OpenAI client (plan-aware)
    const { openai, keySource } = await resolveOpenAiClient({
      tenantId: tenant.id,
      consumeGrace: !isPhase2,
      forceKeySource: isPhase2 ? phase2KeySource : null,
      debug,
    });

    const aiEnvelope = {
      liveQaEnabled: resolved.tenant.liveQaEnabled,
      liveQaMaxQuestions: resolved.tenant.liveQaMaxQuestions,
      tenantRenderEnabled: resolved.tenant.tenantRenderEnabled,
      renderOptIn: undefined as boolean | undefined,
      tenantStyleKey: resolved.tenant.tenantStyleKey ?? undefined,
      tenantRenderNotes: resolved.tenant.tenantRenderNotes ?? undefined,
      industryKey: industryKeyForQuote,
      industryPromptPackApplied: (resolved as any)?.meta?.industryPromptPackApplied ?? undefined,
      llmKeySource: keySource,
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
        return NextResponse.json({ ok: false, error: "MISSING_CUSTOMER_IN_LOG", ...(debugEnabled ? { debugId } : {}) }, { status: 400 });
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
        llmKeySource: (phase2KeySource ?? keySource) as KeySource,
        pricingPolicy,
      });

      const rawOutput = await generateEstimate({
        openai,
        model: resolved.models.estimatorModel,
        system: resolved.prompts.quoteEstimatorSystem,
        images,
        category,
        service_type,
        notes,
        normalizedAnswers,
      });

      const output = enforcePricingPolicyOnOutput(rawOutput, pricingPolicy);

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

    // ✅ Freeze pricing policy into the quote log input so phase2 uses the same rules.
    const policyToStore = normalizePricingPolicy(pricingPolicy);

    const inputToStore = {
      tenantSlug,
      images,
      render_opt_in: renderOptIn,
      customer,
      industryKeySnapshot: industryKeyForQuote,
      industrySource: "tenant_settings" as const,
      llmKeySource: keySource,
      customer_context: { category, service_type, notes },

      pricing_policy_snapshot: policyToStore,
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
      llmKeySource: keySource,
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
      const questions = await generateQaQuestions({
        openai,
        model: resolved.models.qaModel,
        system: resolved.prompts.qaQuestionGeneratorSystem,
        images,
        category,
        service_type,
        notes,
        maxQuestions: resolved.tenant.liveQaMaxQuestions,
      });

      const qa = { questions, answers: [], askedAt: nowIso() };

      const aiSnapshotAsking = buildAiSnapshot({
        phase: "phase1_qa_asking",
        tenantId: tenant.id,
        tenantSlug,
        renderOptIn,
        resolved,
        industryKey: industryKeyForQuote,
        llmKeySource: keySource,
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

    const rawOutput = await generateEstimate({
      openai,
      model: resolved.models.estimatorModel,
      system: resolved.prompts.quoteEstimatorSystem,
      images,
      category,
      service_type,
      notes,
    });

    const output = enforcePricingPolicyOnOutput(rawOutput, policyToStore);

    const aiSnapshotEstimated = buildAiSnapshot({
      phase: "phase1_estimated",
      tenantId: tenant.id,
      tenantSlug,
      renderOptIn,
      resolved,
      industryKey: industryKeyForQuote,
      llmKeySource: keySource,
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