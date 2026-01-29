// src/app/api/quote/submit/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import OpenAI from "openai";

import { db } from "@/lib/db/client";
import { tenants, tenantSecrets, tenantSettings, quoteLogs } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

import { sendEmail } from "@/lib/email";
import { getTenantEmailConfig } from "@/lib/email/tenantEmail";
import { renderLeadNewEmailHTML } from "@/lib/email/templates/leadNew";
import { renderCustomerReceiptEmailHTML } from "@/lib/email/templates/customerReceipt";

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
      category: z.string().optional(),
    })
    .optional(),

  // Phase 2 fields
  quoteLogId: z.string().uuid().optional(),

  // accept BOTH:
  // - [{question, answer}] (clean)
  // - ["answer1", "answer2"] (what your current QuoteForm sends)
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

/**
 * PCC/LLM guardrails (v1)
 * - No schema changes required.
 * - Uses tenantSettings.aiMode as a profile selector (optional).
 * - Uses env var PCC_LLM_GUARDRAILS (optional) to override defaults.
 *
 * Later: swap this loader to DB-backed prompt sets from PCC without touching quote logic.
 */
type LlmGuardrails = {
  profile: string;
  extraSystemPreamble?: string;
  denylist?: string[]; // keywords to avoid
  maxQaQuestions?: number;
};

function loadPlatformGuardrails(): LlmGuardrails {
  // optional JSON override (keeps deploy simple)
  const raw = process.env.PCC_LLM_GUARDRAILS?.trim();
  if (raw) {
    try {
      const j = JSON.parse(raw);
      if (j && typeof j === "object") return j as LlmGuardrails;
    } catch {
      // ignore
    }
  }

  return {
    profile: "standard",
    extraSystemPreamble: [
      "You are producing an estimate for legitimate service work.",
      "Do not provide instructions for wrongdoing or unsafe activity.",
      "Do not request or expose sensitive personal data beyond what is needed for the quote.",
      "If the submission is ambiguous, ask clarifying questions instead of guessing.",
    ].join("\n"),
    denylist: [
      // keep this lightweight; later PCC will manage these
      "credit card",
      "social security",
      "ssn",
      "password",
      "explosive",
      "bomb",
      "weapon",
    ],
    maxQaQuestions: 3,
  };
}

function buildSystemForQa(args: {
  tenantProfile: string;
  extraPreamble?: string;
  maxQuestions: number;
}) {
  const { tenantProfile, extraPreamble, maxQuestions } = args;

  const base = [
    "You generate short, practical clarification questions for a service quote based on photos and notes.",
    "Ask only what is necessary to estimate accurately.",
    "Keep each question to one sentence.",
    "Prefer measurable details (dimensions, quantity, material, access, location).",
    "Avoid questions the photo obviously answers.",
    `Generate up to ${maxQuestions} questions.`,
    "Return ONLY valid JSON: { questions: string[] }",
  ];

  const profile = tenantProfile === "strict"
    ? [
        "Be extra conservative. If unsure, ask the minimum set of questions needed to remove ambiguity.",
        "Do NOT infer dimensions, quantities, or material if not visible.",
      ]
    : [];

  return [extraPreamble, ...profile, ...base].filter(Boolean).join("\n");
}

function buildSystemForEstimate(args: {
  tenantProfile: string;
  extraPreamble?: string;
  hasQa: boolean;
}) {
  const { tenantProfile, extraPreamble, hasQa } = args;

  const base = [
    hasQa
      ? "You are an expert estimator for service work based on photos, customer notes, and follow-up Q&A."
      : "You are an expert estimator for service work based on photos and customer notes.",
    "Be conservative: return a realistic RANGE, not a single number.",
    "If photos are insufficient or ambiguous (or still insufficient after Q&A), set confidence low and inspection_required true.",
    "Do not invent brand/model/year—ask questions instead.",
    "Return ONLY valid JSON matching the provided schema.",
  ];

  const profile = tenantProfile === "strict"
    ? [
        "Bias toward inspection_required=true when any critical info is missing.",
        "If you cannot see it, do not assume it.",
      ]
    : [];

  return [extraPreamble, ...profile, ...base].filter(Boolean).join("\n");
}

function containsDenylistedText(s: string, denylist: string[]) {
  const hay = String(s ?? "").toLowerCase();
  return denylist.some((w) => hay.includes(String(w).toLowerCase()));
}

async function getOpenAiForTenant(tenantId: string) {
  const secretRow = await db
    .select({ openaiKeyEnc: tenantSecrets.openaiKeyEnc })
    .from(tenantSecrets)
    .where(eq(tenantSecrets.tenantId, tenantId))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!secretRow?.openaiKeyEnc) {
    throw new Error("MISSING_OPENAI_KEY");
  }

  const openaiKey = decryptSecret(secretRow.openaiKeyEnc);
  return new OpenAI({ apiKey: openaiKey });
}

// Send initial “received” emails right after creating the quote log.
// Best-effort: never blocks the request.
async function sendReceivedEmails(args: {
  req: Request;
  tenant: { id: string; name: string; slug: string };
  tenantSlug: string;
  quoteLogId: string;
  customer: { name: string; email: string; phone: string };
  notes: string;
  images: Array<{ url: string; shotType?: string }>;
  brandLogoUrl: string | null;
  businessNameFromSettings: string | null;
}) {
  const { req, tenant, tenantSlug, quoteLogId, customer, notes, images, brandLogoUrl, businessNameFromSettings } = args;

  const cfg = await getTenantEmailConfig(tenant.id);
  const effectiveBusinessName = businessNameFromSettings || cfg.businessName || tenant.name;

  const configured = Boolean(
    process.env.RESEND_API_KEY?.trim() && effectiveBusinessName && cfg.leadToEmail && cfg.fromEmail
  );

  const baseUrl = getBaseUrl(req);
  const adminQuoteUrl = baseUrl ? `${baseUrl}/admin/quotes/${encodeURIComponent(quoteLogId)}` : null;

  const result: any = {
    configured,
    mode: cfg.sendMode ?? "standard",
    lead_received: {
      attempted: false,
      ok: false,
      provider: "resend",
      id: null as string | null,
      error: null as string | null,
    },
    customer_received: {
      attempted: false,
      ok: false,
      provider: "resend",
      id: null as string | null,
      error: null as string | null,
    },
  };

  if (!configured) return result;

  // Lead “received”
  try {
    result.lead_received.attempted = true;

    const leadHtml = renderLeadNewEmailHTML({
      businessName: effectiveBusinessName!,
      tenantSlug,
      quoteLogId,
      customer,
      notes,
      imageUrls: images.map((x) => x.url).filter(Boolean),
      brandLogoUrl,
      adminQuoteUrl,

      confidence: null,
      inspectionRequired: null,
      estimateLow: null,
      estimateHigh: null,
      summary: "New request received. Estimate pending.",
      visibleScope: [],
      assumptions: [],
      questions: [],

      renderOptIn: false,
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

    result.lead_received.ok = r1.ok;
    result.lead_received.id = r1.providerMessageId ?? null;
    result.lead_received.error = r1.error ?? null;
  } catch (e: any) {
    result.lead_received.error = e?.message ?? String(e);
  }

  // Customer “received”
  try {
    result.customer_received.attempted = true;

    const custHtml = renderCustomerReceiptEmailHTML({
      businessName: effectiveBusinessName!,
      customerName: customer.name,
      summary: "We received your request. Your estimate is being prepared now.",
      estimateLow: 0,
      estimateHigh: 0,

      confidence: null,
      inspectionRequired: null,
      visibleScope: [],
      assumptions: [],
      questions: [],

      imageUrls: images.map((x) => x.url).filter(Boolean),
      brandLogoUrl,
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
        subject: `We got your request — ${effectiveBusinessName}`,
        html: custHtml,
      },
    });

    result.customer_received.ok = r2.ok;
    result.customer_received.id = r2.providerMessageId ?? null;
    result.customer_received.error = r2.error ?? null;
  } catch (e: any) {
    result.customer_received.error = e?.message ?? String(e);
  }

  return result;
}

async function generateQaQuestions(args: {
  openai: OpenAI;
  system: string;
  images: Array<{ url: string; shotType?: string }>;
  category: string;
  service_type: string;
  notes: string;
  maxQuestions: number;
}) {
  const { openai, system, images, category, service_type, notes, maxQuestions } = args;

  const userText = [
    `Category: ${category}`,
    `Service type: ${service_type}`,
    `Customer notes: ${notes || "(none)"}`,
  ].join("\n");

  const content: any[] = [{ type: "text", text: userText }];
  for (const img of images) {
    if (img?.url) content.push({ type: "image_url", image_url: { url: img.url } });
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
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
  system: string;
  images: Array<{ url: string; shotType?: string }>;
  category: string;
  service_type: string;
  notes: string;
  normalizedAnswers?: Array<{ question: string; answer: string }>;
}) {
  const { openai, system, images, category, service_type, notes, normalizedAnswers } = args;

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
    model: "gpt-4o-mini",
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
  businessNameFromSettings: string | null;
  renderOptIn: boolean;
}) {
  const { req, tenant, tenantSlug, quoteLogId, customer, notes, images, output, brandLogoUrl, businessNameFromSettings, renderOptIn } =
    args;

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

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = Req.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "INVALID_BODY", issues: parsed.error.issues }, { status: 400 });
    }

    const { tenantSlug } = parsed.data;

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

    // Settings (optional)
    const settings = await db
      .select({
        tenantId: tenantSettings.tenantId,
        industryKey: tenantSettings.industryKey,
        aiMode: tenantSettings.aiMode, // used as profile selector for guardrails (v1)
        aiRenderingEnabled: tenantSettings.aiRenderingEnabled,
        brandLogoUrl: tenantSettings.brandLogoUrl,
        businessName: tenantSettings.businessName,

        // Live Q&A
        liveQaEnabled: tenantSettings.liveQaEnabled,
        liveQaMaxQuestions: tenantSettings.liveQaMaxQuestions,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenant.id))
      .limit(1)
      .then((r) => r[0] ?? null);

    const industryKey = settings?.industryKey ?? "service";
    const aiRenderingEnabled = settings?.aiRenderingEnabled === true;

    const brandLogoUrl = safeTrim(settings?.brandLogoUrl) || null;
    const businessNameFromSettings = safeTrim(settings?.businessName) || null;

    // ---- LLM guardrails/profile (v1) ----
    const platform = loadPlatformGuardrails();
    const tenantProfile = safeTrim(settings?.aiMode) || platform.profile || "standard";
    const denylist = Array.isArray(platform.denylist) ? platform.denylist : [];
    const extraPreamble = safeTrim(platform.extraSystemPreamble) || undefined;

    // Live Q&A: tenant setting but capped by platform policy
    const tenantQaEnabled = settings?.liveQaEnabled === true;
    const tenantQaMax = Math.max(1, Math.min(10, Number(settings?.liveQaMaxQuestions ?? 3)));
    const platformQaMax = Math.max(1, Math.min(10, Number(platform.maxQaQuestions ?? 3)));
    const liveQaEnabled = tenantQaEnabled;
    const liveQaMaxQuestions = Math.min(tenantQaMax, platformQaMax);

    // -------------------------
    // Phase 2: finalize after QA
    // -------------------------
    if (parsed.data.quoteLogId && parsed.data.qaAnswers?.length) {
      const quoteLogId = parsed.data.quoteLogId;

      const existing = await db
        .select({ id: quoteLogs.id, input: quoteLogs.input, qa: quoteLogs.qa })
        .from(quoteLogs)
        .where(eq(quoteLogs.id, quoteLogId))
        .limit(1)
        .then((r) => r[0] ?? null);

      if (!existing) {
        return NextResponse.json({ ok: false, error: "QUOTE_NOT_FOUND" }, { status: 404 });
      }

      const inputAny: any = existing.input ?? {};
      const images = Array.isArray(inputAny.images) ? inputAny.images : [];
      const customer = inputAny.customer ?? null;
      const customer_context = inputAny.customer_context ?? {};
      const category = customer_context.category ?? industryKey ?? "service";
      const service_type = customer_context.service_type ?? "upholstery";
      const notes = customer_context.notes ?? "";

      if (!customer?.name || !customer?.email || !customer?.phone) {
        return NextResponse.json({ ok: false, error: "MISSING_CUSTOMER_IN_LOG" }, { status: 400 });
      }

      // Normalize incoming QA answers:
      const qaStored: any = existing.qa ?? {};
      const storedQuestions: string[] = Array.isArray(qaStored?.questions)
        ? qaStored.questions.map((x: any) => String(x)).filter(Boolean)
        : [];

      let normalizedAnswers: Array<{ question: string; answer: string }> = [];

      // If client sent ["a1","a2"], pair with stored questions
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

      // Store answers into quote_logs.qa
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

      const openai = await getOpenAiForTenant(tenant.id);

      const systemEstimate = buildSystemForEstimate({
        tenantProfile,
        extraPreamble,
        hasQa: true,
      });

      // Generate final estimate (with Q&A)
      let output = await generateEstimate({
        openai,
        system: systemEstimate,
        images,
        category,
        service_type,
        notes,
        normalizedAnswers,
      });

      // Persist estimate output
      await db.execute(sql`
        update quote_logs
        set output = ${JSON.stringify(output)}::jsonb
        where id = ${quoteLogId}::uuid
      `);

      // Send final estimate emails (best-effort)
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
          businessNameFromSettings,
          renderOptIn: Boolean(inputAny.render_opt_in),
        });

        const nextOutput = { ...(output ?? {}), email: emailResult };
        await db.execute(sql`
          update quote_logs
          set output = ${JSON.stringify(nextOutput)}::jsonb
          where id = ${quoteLogId}::uuid
        `);
        output = nextOutput;
      } catch (e: any) {
        output = { ...(output ?? {}), email: { configured: false, error: e?.message ?? String(e) } };
      }

      return NextResponse.json({ ok: true, quoteLogId, output });
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

    // lightweight denylist check on freeform notes (guardrail v1)
    const customer_context = parsed.data.customer_context ?? {};
    const category = customer_context.category ?? industryKey ?? "service";
    const service_type = customer_context.service_type ?? "upholstery";
    const notes = customer_context.notes ?? "";

    if (denylist.length && containsDenylistedText(String(notes ?? ""), denylist)) {
      return NextResponse.json(
        {
          ok: false,
          error: "CONTENT_BLOCKED",
          message: "Your request includes content we can’t process. Please revise and try again.",
        },
        { status: 400 }
      );
    }

    const openai = await getOpenAiForTenant(tenant.id);

    // Only allow render opt-in if tenant enabled it
    const renderOptIn = aiRenderingEnabled ? Boolean(parsed.data.render_opt_in) : false;

    // Store input
    const inputToStore = {
      tenantSlug,
      images,
      render_opt_in: renderOptIn,
      customer,
      customer_context: { category, service_type, notes },
      createdAt: nowIso(),
    };

    // Create quote log now (so Q&A can reference it)
    const inserted = await db
      .insert(quoteLogs)
      .values({
        tenantId: tenant.id,
        input: inputToStore,
        output: {}, // will be filled later
        renderOptIn,
        qaStatus: "none",
      })
      .returning({ id: quoteLogs.id })
      .then((r) => r[0] ?? null);

    const quoteLogId = inserted?.id ? String(inserted.id) : null;
    if (!quoteLogId) {
      return NextResponse.json({ ok: false, error: "FAILED_TO_CREATE_QUOTE" }, { status: 500 });
    }

    // ✅ Send “received” emails immediately (best-effort), and persist result
    try {
      const received = await sendReceivedEmails({
        req,
        tenant: { id: tenant.id, name: tenant.name ?? "Business", slug: tenant.slug },
        tenantSlug,
        quoteLogId,
        customer,
        notes,
        images,
        brandLogoUrl,
        businessNameFromSettings,
      });

      await db.execute(sql`
        update quote_logs
        set output = ${JSON.stringify({ email_received: received })}::jsonb
        where id = ${quoteLogId}::uuid
      `);
    } catch {
      // ignore — best effort
    }

    // If live QA is enabled, ask clarifying questions first
    if (liveQaEnabled) {
      const systemQa = buildSystemForQa({
        tenantProfile,
        extraPreamble,
        maxQuestions: liveQaMaxQuestions,
      });

      const questions = await generateQaQuestions({
        openai,
        system: systemQa,
        images,
        category,
        service_type,
        notes,
        maxQuestions: liveQaMaxQuestions,
      });

      const qa = {
        questions,
        answers: [],
        askedAt: nowIso(),
      };

      await db
        .update(quoteLogs)
        .set({
          qa: qa as any,
          qaStatus: "asking",
          qaAskedAt: new Date(),
        })
        .where(eq(quoteLogs.id, quoteLogId));

      return NextResponse.json({
        ok: true,
        quoteLogId,
        needsQa: true,
        questions,
        qa,
      });
    }

    // Otherwise, do estimate immediately
    const systemEstimate = buildSystemForEstimate({
      tenantProfile,
      extraPreamble,
      hasQa: false,
    });

    let output = await generateEstimate({
      openai,
      system: systemEstimate,
      images,
      category,
      service_type,
      notes,
    });

    // Persist estimate output
    await db.execute(sql`
      update quote_logs
      set output = ${JSON.stringify(output)}::jsonb
      where id = ${quoteLogId}::uuid
    `);

    // Send estimate emails (best-effort)
    try {
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

      if (configured) {
        // Lead email
        try {
          emailResult.lead_new.attempted = true;

          const leadHtml = renderLeadNewEmailHTML({
            businessName: effectiveBusinessName!,
            tenantSlug,
            quoteLogId,
            customer,
            notes,
            imageUrls: images.map((x: any) => x.url).filter(Boolean),
            brandLogoUrl,
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

        // Customer receipt
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

            imageUrls: images.map((x: any) => x.url).filter(Boolean),
            brandLogoUrl,
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
      }

      const nextOutput = { ...(output ?? {}), email: emailResult };
      await db.execute(sql`
        update quote_logs
        set output = ${JSON.stringify(nextOutput)}::jsonb
        where id = ${quoteLogId}::uuid
      `);
      output = nextOutput;
    } catch (e: any) {
      output = { ...(output ?? {}), email: { configured: false, error: e?.message ?? String(e) } };
    }

    return NextResponse.json({ ok: true, quoteLogId, output });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (msg === "MISSING_OPENAI_KEY") {
      return NextResponse.json({ ok: false, error: "MISSING_OPENAI_KEY" }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status: 500 });
  }
}