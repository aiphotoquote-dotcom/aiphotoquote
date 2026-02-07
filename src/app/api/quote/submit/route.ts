// src/app/api/quote/submit/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import OpenAI from "openai";
import crypto from "crypto";

import { db } from "@/lib/db/client";
import { tenants, tenantSecrets, tenantSettings, quoteLogs, platformConfig } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

import { sendEmail } from "@/lib/email";
import { getTenantEmailConfig } from "@/lib/email/tenantEmail";
import { renderLeadNewEmailHTML } from "@/lib/email/templates/leadNew";
import { renderCustomerReceiptEmailHTML } from "@/lib/email/templates/customerReceipt";

// ✅ Tenant-aware PCC resolver (platform defaults + tenant overrides)
import { resolveTenantLlm } from "@/lib/pcc/llm/resolveTenant";

// ✅ PCC config loader + industry prompt pack resolver
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

  // Phase 1 fields
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
      category: z.string().optional(), // NOTE: accepted for back-compat, but server will prefer tenant industry snapshot
    })
    .optional(),

  // Phase 2 fields
  quoteLogId: z.string().uuid().optional(),

  // accept BOTH:
  // - [{question, answer}] (clean)
  // - ["answer1", "answer2"] (what QuoteForm currently sends)
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
  return s; // keep forward-compatible
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

function startOfMonthUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}
function startOfNextMonthUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

type KeySource = "tenant" | "platform_grace";

function platformOpenAiKey(): string | null {
  const k =
    process.env.PLATFORM_OPENAI_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    "";
  return k ? k : null;
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
}): Promise<{ openai: OpenAI; keySource: KeySource }> {
  const { tenantId, consumeGrace, forceKeySource } = args;

  // 1) Tenant key if exists (unless explicitly forced to platform)
  if (!forceKeySource || forceKeySource === "tenant") {
    const secretRow = await db
      .select({ openaiKeyEnc: tenantSecrets.openaiKeyEnc })
      .from(tenantSecrets)
      .where(eq(tenantSecrets.tenantId, tenantId))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (secretRow?.openaiKeyEnc) {
      const openaiKey = decryptSecret(secretRow.openaiKeyEnc);
      return { openai: new OpenAI({ apiKey: openaiKey }), keySource: "tenant" };
    }

    // If caller forced tenant but no key, fall through to error/plan logic
    if (forceKeySource === "tenant") {
      const e: any = new Error("MISSING_OPENAI_KEY");
      e.code = "MISSING_OPENAI_KEY";
      throw e;
    }
  }

  // 2) Platform grace key
  const platformKey = platformOpenAiKey();
  if (!platformKey) {
    const e: any = new Error("MISSING_OPENAI_KEY");
    e.code = "MISSING_OPENAI_KEY";
    throw e;
  }

  // If we are not consuming grace (phase2 finalize), allow platform usage
  // even if grace is currently exhausted, as long as phase1 already decided so.
  if (!consumeGrace) {
    return { openai: new OpenAI({ apiKey: platformKey }), keySource: "platform_grace" };
  }

  // Consume grace atomically
  const upd = await db.execute(sql`
    update tenant_settings
    set activation_grace_used = activation_grace_used + 1,
        updated_at = now()
    where tenant_id = ${tenantId}::uuid
      and activation_grace_used < activation_grace_credits
    returning activation_grace_used, activation_grace_credits
  `);

  const row = (upd as any)?.rows?.[0] ?? null;
  if (!row) {
    const e: any = new Error("TRIAL_EXHAUSTED");
    e.code = "TRIAL_EXHAUSTED";
    e.status = 402;
    throw e;
  }

  return { openai: new OpenAI({ apiKey: platformKey }), keySource: "platform_grace" };
}

/**
 * ✅ Auditable AI snapshot:
 * - store prompt hashes (not full prompts) to avoid giant JSON + accidental leakage
 * - persist models/guardrails/tenant flags/pricing
 */
function buildAiSnapshot(args: {
  phase: "phase1_insert" | "phase1_qa_asking" | "phase1_estimated" | "phase2_finalized";
  tenantId: string;
  tenantSlug: string;
  renderOptIn: boolean;
  resolved: any;
  industryKey: string;
  llmKeySource: KeySource;
}) {
  const { phase, tenantId, tenantSlug, renderOptIn, resolved, industryKey, llmKeySource } = args;

  const quoteEstimatorSystem = resolved?.prompts?.quoteEstimatorSystem ?? "";
  const qaQuestionGeneratorSystem = resolved?.prompts?.qaQuestionGeneratorSystem ?? "";

  return {
    version: 1,
    capturedAt: nowIso(),
    phase,

    tenant: {
      tenantId,
      tenantSlug,
      industryKey,
    },

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

    pricing: resolved.pricing ?? null,
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
    customer_receipt: {
      attempted: false,
      ok: false,
      provider: "resend",
      id: null as string | null,
      error: null as string | null,
    },
  };

  if (!configured) return emailResult;

  // Lead email
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

  // Customer email
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

  const qaText =
    normalizedAnswers?.length
      ? normalizedAnswers.map((x) => `Q: ${x.question}\nA: ${x.answer}`).join("\n\n")
      : "";

  const userText = [
    `Category: ${category}`,
    `Service type: ${service_type}`,
    `Customer notes: ${notes || "(none)"}`,
    normalizedAnswers?.length ? "" : "",
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
          required: [
            "confidence",
            "inspection_required",
            "estimate_low",
            "estimate_high",
            "summary",
            "visible_scope",
            "assumptions",
            "questions",
          ],
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

  let output: any;
  const safe = AiOutputSchema.safeParse(outputParsed);
  if (!safe.success) {
    output = {
      confidence: "low",
      inspection_required: true,
      estimate_low: 0,
      estimate_high: 0,
      currency: "USD",
      summary:
        "We couldn't generate a structured estimate from the submission. Please add 2–6 clear photos and any details you can.",
      visible_scope: [],
      assumptions: [],
      questions: ["Can you add a wide shot and 1–2 close-ups of the problem area?"],
      _raw: raw,
    };
  } else {
    const v = safe.data;
    const { low, high } = ensureLowHigh(v.estimate_low, v.estimate_high);
    output = {
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

  return output;
}

// ----------------- handler -----------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = Req.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "INVALID_BODY", issues: parsed.error.issues }, { status: 400 });
    }

    const { tenantSlug } = parsed.data;

    // ✅ platform gates
    const pc = await db
      .select({
        aiQuotingEnabled: platformConfig.aiQuotingEnabled,
        maintenanceEnabled: platformConfig.maintenanceEnabled,
        maintenanceMessage: platformConfig.maintenanceMessage,
      })
      .from(platformConfig)
      .limit(1)
      .then((r) => r[0] ?? null);

    if (pc?.maintenanceEnabled) {
      return NextResponse.json(
        { ok: false, error: "MAINTENANCE", message: pc.maintenanceMessage || "Service temporarily unavailable." },
        { status: 503 }
      );
    }
    if (pc && pc.aiQuotingEnabled === false) {
      return NextResponse.json(
        { ok: false, error: "AI_DISABLED", message: "AI quoting is currently disabled." },
        { status: 503 }
      );
    }

    // Tenant lookup
    const tenant = await db
      .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.slug, tenantSlug))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!tenant) {
      return NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND" }, { status: 404 });
    }

    // Determine phase early
    const isPhase2 = Boolean(parsed.data.quoteLogId && parsed.data.qaAnswers?.length);

    // Settings (optional)
    const settings = await db
      .select({
        tenantId: tenantSettings.tenantId,
        industryKey: tenantSettings.industryKey,
        brandLogoUrl: tenantSettings.brandLogoUrl,
        brandLogoVariant: (tenantSettings as any).brandLogoVariant,
        businessName: tenantSettings.businessName,

        // ✅ plan fields
        planTier: tenantSettings.planTier,
        monthlyQuoteLimit: tenantSettings.monthlyQuoteLimit,
        activationGraceCredits: tenantSettings.activationGraceCredits,
        activationGraceUsed: tenantSettings.activationGraceUsed,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenant.id))
      .limit(1)
      .then((r) => r[0] ?? null);

    // ✅ enforce plan limits on phase 1 only
    if (!isPhase2) {
      const limit = typeof settings?.monthlyQuoteLimit === "number" ? settings.monthlyQuoteLimit : null;
      await enforceMonthlyLimit({ tenantId: tenant.id, monthlyQuoteLimit: limit });
    }

    const tenantIndustryKey = safeTrim(settings?.industryKey) || "service";
    const brandLogoUrl = safeTrim(settings?.brandLogoUrl) || null;
    const brandLogoVariant: BrandLogoVariant = normalizeBrandLogoVariant((settings as any)?.brandLogoVariant);
    const businessNameFromSettings = safeTrim(settings?.businessName) || null;

    // Pre-load quote log if phase2 (needed for immutable industry + key source)
    let phase2Existing: { id: string; input: any; qa: any; output: any } | null = null;
    let industryKeyForQuote = tenantIndustryKey;
    let phase2KeySource: KeySource | null = null;

    if (isPhase2) {
      const quoteLogId = parsed.data.quoteLogId!;
      phase2Existing = await db
        .select({ id: quoteLogs.id, input: quoteLogs.input, qa: quoteLogs.qa, output: quoteLogs.output })
        .from(quoteLogs)
        .where(eq(quoteLogs.id, quoteLogId))
        .limit(1)
        .then((r) => r[0] ?? null);

      if (!phase2Existing) {
        return NextResponse.json({ ok: false, error: "QUOTE_NOT_FOUND" }, { status: 404 });
      }

      const inputAny: any = phase2Existing.input ?? {};
      industryKeyForQuote = pickIndustrySnapshotFromInput(inputAny) || tenantIndustryKey;

      const ks = String(inputAny?.llmKeySource ?? "").trim();
      phase2KeySource = ks === "platform_grace" ? "platform_grace" : ks === "tenant" ? "tenant" : null;
    } else {
      industryKeyForQuote = tenantIndustryKey;
    }

    // ✅ Resolve tenant + PCC AI settings ONCE (request-scoped)
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

    const resolved = {
      ...resolvedBase,
      prompts: {
        ...resolvedBase.prompts,
        quoteEstimatorSystem: effectivePrompts.quoteEstimatorSystem,
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

    // ✅ denylist guardrail (PCC)
    const denylist = resolved.guardrails.blockedTopics ?? [];

    // ✅ Resolve OpenAI client (plan-aware)
    const { openai, keySource } = await resolveOpenAiClient({
      tenantId: tenant.id,
      consumeGrace: !isPhase2, // consume only on phase1 submit
      forceKeySource: isPhase2 ? phase2KeySource : null,
    });

    // ✅ always return server-authoritative ai flags to client
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
        return NextResponse.json({ ok: false, error: "MISSING_CUSTOMER_IN_LOG" }, { status: 400 });
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

      if (storedQuestions.length) {
        normalizedAnswers = normalizedAnswers.slice(0, storedQuestions.length);
      }

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
            { ok: false, error: "CONTENT_BLOCKED", message: "Your answers include content we can’t process. Please revise." },
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
      });

      const systemEstimate = resolved.prompts.quoteEstimatorSystem;

      const output = await generateEstimate({
        openai,
        model: resolved.models.estimatorModel,
        system: systemEstimate,
        images,
        category,
        service_type,
        notes,
        normalizedAnswers,
      });

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

      return NextResponse.json({ ok: true, quoteLogId, output: outputToStore, ai: aiEnvelope });
    }

    // -------------------------
    // Phase 1: initial submission
    // -------------------------
    const images = parsed.data.images ?? [];

    const incoming = parsed.data.customer ?? parsed.data.contact;
    if (!incoming) {
      return NextResponse.json(
        { ok: false, error: "MISSING_CUSTOMER", message: "Customer info is required (name, phone, email)." },
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
        { ok: false, error: "INVALID_PHONE", message: "Phone must include at least 10 digits." },
        { status: 400 }
      );
    }

    if (!images.length) {
      return NextResponse.json(
        { ok: false, error: "MISSING_IMAGES", message: "At least 1 image is required." },
        { status: 400 }
      );
    }

    const customer_context = parsed.data.customer_context ?? {};

    const category = industryKeyForQuote || "service";
    const service_type = safeTrim(customer_context.service_type) || "upholstery";
    const notes = safeTrim(customer_context.notes) || "";

    if (denylist.length && containsDenylistedText(notes, denylist)) {
      return NextResponse.json(
        { ok: false, error: "CONTENT_BLOCKED", message: "Your request includes content we can’t process. Please revise and try again." },
        { status: 400 }
      );
    }

    const renderOptIn = resolved.tenant.tenantRenderEnabled ? Boolean(parsed.data.render_opt_in) : false;
    aiEnvelope.renderOptIn = renderOptIn;

    // Store input (✅ includes immutable industry snapshot + key source for phase2)
    const inputToStore = {
      tenantSlug,
      images,
      render_opt_in: renderOptIn,
      customer,

      // ✅ immutable industry snapshot
      industryKeySnapshot: industryKeyForQuote,
      industrySource: "tenant_settings" as const,

      // ✅ critical for phase2 finalize in trial mode
      llmKeySource: keySource,

      customer_context: { category, service_type, notes },
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
      return NextResponse.json({ ok: false, error: "FAILED_TO_CREATE_QUOTE" }, { status: 500 });
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

      return NextResponse.json({ ok: true, quoteLogId, needsQa: true, questions, qa, ai: aiEnvelope });
    }

    const output = await generateEstimate({
      openai,
      model: resolved.models.estimatorModel,
      system: resolved.prompts.quoteEstimatorSystem,
      images,
      category,
      service_type,
      notes,
    });

    const aiSnapshotEstimated = buildAiSnapshot({
      phase: "phase1_estimated",
      tenantId: tenant.id,
      tenantSlug,
      renderOptIn,
      resolved,
      industryKey: industryKeyForQuote,
      llmKeySource: keySource,
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

    return NextResponse.json({ ok: true, quoteLogId, output: outputToStore, ai: aiEnvelope });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const code = e?.code || msg;

    if (code === "PLAN_LIMIT_REACHED") {
      return NextResponse.json(
        { ok: false, error: "PLAN_LIMIT_REACHED", message: "Monthly quote limit reached for your plan.", meta: e?.meta ?? undefined },
        { status: 402 }
      );
    }

    if (code === "TRIAL_EXHAUSTED") {
      return NextResponse.json(
        {
          ok: false,
          error: "TRIAL_EXHAUSTED",
          message: "Trial credits exhausted. Add your OpenAI key in Settings (AI Setup) or upgrade your plan.",
        },
        { status: 402 }
      );
    }

    if (code === "MISSING_OPENAI_KEY") {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_OPENAI_KEY",
          message: "No OpenAI key is configured for this tenant. Add a tenant key in AI Setup.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status: 500 });
  }
}