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
  // - [{question, answer}] (future/clean)
  // - ["answer1", "answer2"] (what your current QuoteForm sends)
  qaAnswers: z
    .union([z.array(QaAnswerSchema), z.array(z.string().min(1))])
    .optional(),
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
    lead_received: { attempted: false, ok: false, provider: "resend", id: null as string | null, error: null as string | null },
    customer_received: { attempted: false, ok: false, provider: "resend", id: null as string | null, error: null as string | null },
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

      // no estimate yet:
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
      context: { type: "lead_received", quoteLogId },
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
      context: { type: "customer_received", quoteLogId },
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

// ===== PART 2/4 =====

// ----------------- main -----------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = Req.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "INVALID_BODY", issues: parsed.error.issues },
        { status: 400 }
      );
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

    const liveQaEnabled = settings?.liveQaEnabled === true;
    const liveQaMaxQuestions = Math.max(1, Math.min(10, Number(settings?.liveQaMaxQuestions ?? 3)));

    const brandLogoUrl = safeTrim(settings?.brandLogoUrl) || null;
    const businessNameFromSettings = safeTrim(settings?.businessName) || null;

    // -------------------------
    // Phase 2: answer QA (finalize estimate)
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
      // - if client sent [{question, answer}], use it
      // - if client sent ["a1","a2"], pair with stored questions from quote_logs.qa.questions
      const qaStored: any = existing.qa ?? {};
      const storedQuestions: string[] = Array.isArray(qaStored?.questions)
        ? qaStored.questions.map((x: any) => String(x)).filter(Boolean)
        : [];

      let normalizedAnswers: Array<{ question: string; answer: string }> = [];

      if (Array.isArray(parsed.data.qaAnswers) && typeof parsed.data.qaAnswers[0] === "string") {
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

      const system = [
        "You are an expert estimator for service work based on photos, customer notes, and follow-up Q&A.",
        "Be conservative: return a realistic RANGE, not a single number.",
        "If still insufficient, set confidence low and inspection_required true.",
        "Do not invent brand/model/year—ask questions instead.",
        "Return ONLY valid JSON matching the provided schema.",
      ].join("\n");

      const qaText = normalizedAnswers
        .map((x) => `Q: ${x.question}\nA: ${x.answer}`)
        .join("\n\n");

      const userText = [
        `Category: ${category}`,
        `Service type: ${service_type}`,
        `Customer notes: ${notes || "(none)"}`,
        "",
        "Follow-up Q&A:",
        qaText || "(none)",
        "",
        "Instructions:",
        "- Use the photos to identify the item, material type, and visible damage/wear.",
        "- Provide estimate_low and estimate_high (whole dollars).",
        "- Provide visible_scope as short bullet-style strings.",
        "- Provide assumptions and questions (3–8 items each is fine).",
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

      // Update quote output + stage
      await db.execute(sql`
        update quote_logs
        set output = ${JSON.stringify(output)}::jsonb
        where id = ${quoteLogId}::uuid
      `);

      // (emails + response continue in PART 3)
// ===== PART 3/4 =====

      return NextResponse.json({
        ok: true,
        quoteLogId,
        needsQa: true,
        // IMPORTANT: frontend expects `questions` at top-level
        questions,
        qa,
      });
    }

    // Otherwise, do estimate immediately (your old behavior)
    const system = [
      "You are an expert estimator for service work based on photos and customer notes.",
      "Be conservative: return a realistic RANGE, not a single number.",
      "If photos are insufficient or ambiguous, set confidence low and inspection_required true.",
      "Do not invent brand/model/year—ask questions instead.",
      "Return ONLY valid JSON matching the provided schema.",
    ].join("\n");

    const userText = [
      `Category: ${category}`,
      `Service type: ${service_type}`,
      `Customer notes: ${notes || "(none)"}`,
      "",
      "Instructions:",
      "- Use the photos to identify the item, material type, and visible damage/wear.",
      "- Provide estimate_low and estimate_high (whole dollars).",
      "- Provide visible_scope as short bullet-style strings.",
      "- Provide assumptions and questions (3–8 items each is fine).",
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
          "We couldn't generate a structured estimate from this submission. Please add 2–6 clear photos and any details you can.",
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

    // Update quote output
    await db.execute(sql`
      update quote_logs
      set output = ${JSON.stringify(output)}::jsonb
      where id = ${quoteLogId}::uuid
    `);

    // -------------------------
    // Email (best effort) - PHASE 1 TOO (fixes “no initial email”)
    // -------------------------
    let emailResult: any = null;
    try {
      const cfg = await getTenantEmailConfig(tenant.id);
      const effectiveBusinessName = businessNameFromSettings || cfg.businessName || tenant.name;

      const configured = Boolean(
        process.env.RESEND_API_KEY?.trim() &&
          effectiveBusinessName &&
          cfg.leadToEmail &&
          cfg.fromEmail
      );

      const baseUrl = getBaseUrl(req);
      const adminQuoteUrl = baseUrl ? `${baseUrl}/admin/quotes/${encodeURIComponent(quoteLogId)}` : null;

      emailResult = {
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

      // persist email into output.email
      try {
        const nextOutput = { ...(output ?? {}), email: emailResult };
        await db.execute(sql`
          update quote_logs
          set output = ${JSON.stringify(nextOutput)}::jsonb
          where id = ${quoteLogId}::uuid
        `);
        output = nextOutput;
      } catch {
        // ignore
      }
    } catch (e: any) {
      output = { ...(output ?? {}), email: { configured: false, error: e?.message ?? String(e) } };
    }

    return NextResponse.json({ ok: true, quoteLogId, output });

    // (rest continues in PART 4/4)

// ===== PART 4/4 =====

  } catch (e: any) {
    const msg = e?.message ?? String(e);
    // preserve your known error signals
    if (msg === "MISSING_OPENAI_KEY") {
      return NextResponse.json({ ok: false, error: "MISSING_OPENAI_KEY" }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status: 500 });
  }
}