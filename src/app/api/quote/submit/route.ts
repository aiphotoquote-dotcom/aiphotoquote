import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import OpenAI from "openai";
import crypto from "crypto";
import { Resend } from "resend";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";

const Req = z.object({
  tenantSlug: z.string().min(3),
  images: z.array(z.object({ url: z.string().url() })).min(1).max(12),
  customer_context: z
    .object({
      notes: z.string().optional(),
      service_type: z.string().optional(),
      category: z.string().optional(),
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
    })
    .optional(),
});

const QuoteAssessmentSchema = z.object({
  confidence: z.enum(["high", "medium", "low"]),
  inspection_required: z.boolean(),
  summary: z.string(),
  visible_scope: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  questions: z.array(z.string()).default([]),
});

type PricingRules = {
  min_job: number | null;
  typical_low: number | null;
  typical_high: number | null;
  max_without_inspection: number | null;
};

function json(data: any, status = 200, debugId?: string) {
  const res = NextResponse.json(debugId ? { debugId, ...data } : data, { status });
  if (debugId) res.headers.set("x-debug-id", debugId);
  return res;
}

function normalizeDbErr(err: any) {
  return {
    name: err?.name,
    message: err?.message ?? String(err),
    code: err?.code,
    detail: err?.detail,
    hint: err?.hint,
    constraint: err?.constraint,
    table: err?.table,
    column: err?.column,
    where: err?.where,
    causeMessage: err?.cause?.message,
    causeCode: err?.cause?.code,
    causeDetail: err?.cause?.detail,
  };
}

function normalizeErr(err: any) {
  const status = typeof err?.status === "number" ? err.status : undefined;
  const message =
    err?.error?.message ??
    err?.response?.data?.error?.message ??
    err?.message ??
    String(err);
  const type = err?.error?.type ?? err?.response?.data?.error?.type ?? err?.type;
  const code = err?.error?.code ?? err?.response?.data?.error?.code ?? err?.code;
  return {
    name: err?.name,
    status,
    message,
    type,
    code,
    request_id: err?.request_id ?? err?.headers?.["x-request-id"],
  };
}

async function getTenantBySlug(tenantSlug: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug)).limit(1);
  return rows[0] ?? null;
}

// tenant_secrets: tenant_id, openai_key_enc
async function getTenantOpenAiKey(tenantId: string): Promise<string | null> {
  const r = await db.execute(
    sql`select openai_key_enc from tenant_secrets where tenant_id = ${tenantId} limit 1`
  );
  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  const enc = row?.openai_key_enc ?? null;
  if (!enc) return null;
  return decryptSecret(enc);
}

// tenant_settings: business_name, lead_to_email, resend_from_email
async function getTenantEmailSettings(tenantId: string) {
  const r = await db.execute(sql`
    select business_name, lead_to_email, resend_from_email
    from tenant_settings
    where tenant_id = ${tenantId}
    limit 1
  `);
  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

  return {
    businessName: row?.business_name ?? null,
    leadToEmail: row?.lead_to_email ?? null,
    resendFromEmail: row?.resend_from_email ?? null,
  };
}

// tenant_pricing_rules: min_job, typical_low, typical_high, max_without_inspection
async function getTenantPricingRules(tenantId: string): Promise<PricingRules> {
  // Choose the most recent rules row if multiple exist.
  const r = await db.execute(sql`
    select min_job, typical_low, typical_high, max_without_inspection
    from tenant_pricing_rules
    where tenant_id = ${tenantId}::uuid
    order by created_at desc nulls last
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

  return {
    min_job: typeof row?.min_job === "number" ? row.min_job : row?.min_job ? Number(row.min_job) : null,
    typical_low:
      typeof row?.typical_low === "number" ? row.typical_low : row?.typical_low ? Number(row.typical_low) : null,
    typical_high:
      typeof row?.typical_high === "number" ? row.typical_high : row?.typical_high ? Number(row.typical_high) : null,
    max_without_inspection:
      typeof row?.max_without_inspection === "number"
        ? row.max_without_inspection
        : row?.max_without_inspection
          ? Number(row.max_without_inspection)
          : null,
  };
}

/**
 * Pricing logic (simple + tenant-controlled):
 * - If typical_low/high exist, use them as a base range.
 * - Apply min_job floor.
 * - If inspection_required=false and max_without_inspection exists, cap the HIGH.
 * - If confidence=low, widen the range slightly.
 * - If confidence=high and inspection_required=false, tighten slightly.
 */
function priceFromRules(args: {
  rules: PricingRules;
  confidence: "high" | "medium" | "low";
  inspection_required: boolean;
}): { low: number; high: number } | null {
  const { rules, confidence, inspection_required } = args;

  let low = rules.typical_low ?? null;
  let high = rules.typical_high ?? null;

  // If tenant hasn't configured pricing guardrails yet, do not fabricate pricing.
  if (low == null || high == null) return null;

  // normalize ordering
  if (high < low) {
    const tmp = high;
    high = low;
    low = tmp;
  }

  // min job floor
  if (typeof rules.min_job === "number" && rules.min_job > 0) {
    low = Math.max(low, rules.min_job);
    high = Math.max(high, rules.min_job);
  }

  // confidence adjustments
  if (confidence === "low") {
    // widen by 25%
    const span = Math.max(50, high - low);
    low = Math.max(0, Math.round(low - span * 0.15));
    high = Math.round(high + span * 0.15);
  } else if (confidence === "high" && !inspection_required) {
    // tighten by 10%
    const span = Math.max(50, high - low);
    low = Math.round(low + span * 0.05);
    high = Math.round(high - span * 0.05);
    if (high < low) high = low;
  }

  // cap high if tenant wants "no inspection max"
  if (!inspection_required && typeof rules.max_without_inspection === "number" && rules.max_without_inspection > 0) {
    high = Math.min(high, rules.max_without_inspection);
    if (high < low) low = high;
  }

  // final rounding
  low = Math.round(low);
  high = Math.round(high);

  return { low, high };
}

async function preflightImageUrl(url: string) {
  const out: { ok: boolean; url: string; status?: number; hint?: string } = { ok: false, url };

  try {
    const headRes = await fetch(url, { method: "HEAD", redirect: "follow" });
    out.status = headRes.status;
    if (headRes.ok) {
      out.ok = true;
      return out;
    }
    out.hint = `HEAD returned ${headRes.status}`;
  } catch (e: any) {
    out.hint = `HEAD failed: ${e?.message ?? "unknown"}`;
  }

  try {
    const getRes = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { Range: "bytes=0-1023" },
    });
    out.status = getRes.status;
    if (getRes.ok || getRes.status === 206) {
      out.ok = true;
      return out;
    }
    out.hint = `GET returned ${getRes.status}`;
    return out;
  } catch (e: any) {
    out.hint = `GET failed: ${e?.message ?? "unknown"}`;
    return out;
  }
}

/**
 * quote_logs columns: id, tenant_id, input, output, created_at, confidence, estimate_low, estimate_high, inspection_required
 */
async function insertQuoteLog(tenantId: string, inputJson: any) {
  const quoteLogId = crypto.randomUUID();
  const inputStr = JSON.stringify(inputJson ?? {});
  const outputStr = JSON.stringify({ status: "started" });

  await db.execute(sql`
    insert into quote_logs (id, tenant_id, input, output, created_at)
    values (${quoteLogId}::uuid, ${tenantId}, ${inputStr}::jsonb, ${outputStr}::jsonb, now())
  `);

  return quoteLogId;
}

async function updateQuoteLogOutput(quoteLogId: string, output: any) {
  const outputStr = JSON.stringify(output ?? {});
  await db.execute(sql`
    update quote_logs
    set output = ${outputStr}::jsonb
    where id = ${quoteLogId}::uuid
  `);
}

async function updateQuoteLogSummaryFields(args: {
  quoteLogId: string;
  confidence: string | null;
  inspectionRequired: boolean | null;
  estimateLow: number | null;
  estimateHigh: number | null;
}) {
  const { quoteLogId, confidence, inspectionRequired, estimateLow, estimateHigh } = args;

  await db.execute(sql`
    update quote_logs
    set
      confidence = ${confidence},
      inspection_required = ${inspectionRequired},
      estimate_low = ${estimateLow},
      estimate_high = ${estimateHigh}
    where id = ${quoteLogId}::uuid
  `);
}

function esc(s: unknown) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderLeadEmailHTML(args: {
  tenantSlug: string;
  quoteLogId: string;
  customer: { name?: string; email?: string; phone?: string };
  category?: string;
  notes?: string;
  images: string[];
  assessment: any;
  estimate?: { low: number; high: number } | null;
}) {
  const { tenantSlug, quoteLogId, customer, category, notes, images, assessment, estimate } = args;

  const imgs = images
    .map(
      (u) =>
        `<div style="margin:10px 0;"><a href="${esc(u)}">${esc(u)}</a><br/><img src="${esc(
          u
        )}" alt="uploaded photo" style="max-width:560px;width:100%;border-radius:10px;border:1px solid #e5e7eb"/></div>`
    )
    .join("");

  const estHtml =
    estimate && typeof estimate.low === "number" && typeof estimate.high === "number"
      ? `<div style="margin:8px 0 0;color:#111;"><b>Estimate</b>: $${Math.round(estimate.low).toLocaleString()} – $${Math.round(
          estimate.high
        ).toLocaleString()}</div>`
      : "";

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.4;color:#111;">
    <h2 style="margin:0 0 8px;">New Photo Quote</h2>
    <div style="margin:0 0 12px;color:#374151;">
      <div><b>Tenant</b>: ${esc(tenantSlug)}</div>
      <div><b>Quote Log ID</b>: ${esc(quoteLogId)}</div>
      <div><b>Category</b>: ${esc(category || "")}</div>
      ${estHtml}
    </div>

    <h3 style="margin:18px 0 6px;">Customer</h3>
    <div style="color:#374151;">
      <div><b>Name</b>: ${esc(customer.name || "")}</div>
      <div><b>Email</b>: ${esc(customer.email || "")}</div>
      <div><b>Phone</b>: ${esc(customer.phone || "")}</div>
    </div>

    ${
      notes
        ? `<h3 style="margin:18px 0 6px;">Notes</h3><div style="white-space:pre-wrap;color:#374151;">${esc(
            notes
          )}</div>`
        : ""
    }

    <h3 style="margin:18px 0 6px;">Photos</h3>
    ${imgs}

    <h3 style="margin:18px 0 6px;">AI Assessment</h3>
    <pre style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:12px;white-space:pre-wrap;">${esc(
      JSON.stringify(assessment, null, 2)
    )}</pre>
  </div>`;
}

function renderCustomerEmailHTML(args: {
  businessName: string;
  quoteLogId: string;
  notes?: string;
  images: string[];
  assessment: any;
  estimate?: { low: number; high: number } | null;
}) {
  const { businessName, quoteLogId, notes, images, assessment, estimate } = args;

  const imgs = images
    .map(
      (u) =>
        `<div style="margin:10px 0;"><img src="${esc(
          u
        )}" alt="uploaded photo" style="max-width:560px;width:100%;border-radius:10px;border:1px solid #e5e7eb;border-radius:10px"/></div>`
    )
    .join("");

  const estHtml =
    estimate && typeof estimate.low === "number" && typeof estimate.high === "number"
      ? `<div style="margin:10px 0;padding:12px;border:1px solid #e5e7eb;border-radius:10px;background:#f9fafb;">
          <div style="font-weight:700;color:#111;">Estimated Range</div>
          <div style="font-size:18px;font-weight:700;color:#111;margin-top:4px;">
            $${Math.round(estimate.low).toLocaleString()} – $${Math.round(estimate.high).toLocaleString()}
          </div>
        </div>`
      : "";

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.4;color:#111;">
    <h2 style="margin:0 0 8px;">We received your request</h2>
    <div style="margin:0 0 12px;color:#374151;">
      <div><b>Quote ID</b>: ${esc(quoteLogId)}</div>
    </div>

    <p style="color:#374151;margin:0 0 10px;">
      Thanks for sending photos. Here’s what our AI could see at a glance. We’ll follow up if we need any clarifications.
    </p>

    ${estHtml}

    ${
      notes
        ? `<h3 style="margin:18px 0 6px;">Your Notes</h3><div style="white-space:pre-wrap;color:#374151;">${esc(
            notes
          )}</div>`
        : ""
    }

    <h3 style="margin:18px 0 6px;">Photos Received</h3>
    ${imgs}

    <h3 style="margin:18px 0 6px;">Preliminary Assessment</h3>
    <pre style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:12px;white-space:pre-wrap;">${esc(
      JSON.stringify(assessment, null, 2)
    )}</pre>

    <p style="color:#6b7280;margin-top:14px;">
      — ${esc(businessName)}
    </p>
  </div>`;
}

async function sendEmailsIfConfigured(args: {
  tenantSlug: string;
  quoteLogId: string;
  category?: string;
  notes?: string;
  images: string[];
  assessment: any;
  estimate: { low: number; high: number } | null;
  customer: { name?: string; email?: string; phone?: string };
  tenantEmailSettings: { businessName: string | null; leadToEmail: string | null; resendFromEmail: string | null };
}) {
  const resendKey = process.env.RESEND_API_KEY || "";
  const { businessName, leadToEmail, resendFromEmail } = args.tenantEmailSettings;

  const result = {
    configured: Boolean(resendKey && businessName && leadToEmail && resendFromEmail),
    lead: { attempted: false, sent: false, id: null as string | null, error: null as string | null },
    customer: { attempted: false, sent: false, id: null as string | null, error: null as string | null },
    missingEnv: {
      RESEND_API_KEY: !resendKey,
    },
    missingTenant: {
      business_name: !businessName,
      lead_to_email: !leadToEmail,
      resend_from_email: !resendFromEmail,
    },
  };

  if (!result.configured) return result;

  const resend = new Resend(resendKey);

  // Lead email
  try {
    result.lead.attempted = true;
    const leadHtml = renderLeadEmailHTML({
      tenantSlug: args.tenantSlug,
      quoteLogId: args.quoteLogId,
      customer: args.customer,
      category: args.category,
      notes: args.notes,
      images: args.images,
      assessment: args.assessment,
      estimate: args.estimate,
    });

    const leadRes = await resend.emails.send({
      from: resendFromEmail!,
      to: [leadToEmail!],
      subject: `New Photo Quote (${args.category || "request"}) — ${args.quoteLogId}`,
      html: leadHtml,
    });

    const leadId = (leadRes as any)?.data?.id ?? null;
    if ((leadRes as any)?.error) throw new Error((leadRes as any).error?.message ?? "Resend error");
    result.lead.sent = true;
    result.lead.id = leadId;
  } catch (e: any) {
    result.lead.error = e?.message ?? String(e);
  }

  // Customer receipt (only if we have a customer email)
  if (args.customer.email) {
    try {
      result.customer.attempted = true;

      const custHtml = renderCustomerEmailHTML({
        businessName: businessName!,
        quoteLogId: args.quoteLogId,
        notes: args.notes,
        images: args.images,
        assessment: args.assessment,
        estimate: args.estimate,
      });

      const custRes = await resend.emails.send({
        from: resendFromEmail!,
        to: [args.customer.email],
        subject: `We received your request — Quote ${args.quoteLogId}`,
        html: custHtml,
      });

      const custId = (custRes as any)?.data?.id ?? null;
      if ((custRes as any)?.error) throw new Error((custRes as any).error?.message ?? "Resend error");
      result.customer.sent = true;
      result.customer.id = custId;
    } catch (e: any) {
      result.customer.error = e?.message ?? String(e);
    }
  } else {
    result.customer.error = "No customer email provided; skipping customer receipt.";
  }

  return result;
}

export async function POST(req: Request) {
  const debugId = crypto.randomBytes(6).toString("hex");
  const startedAt = Date.now();
  let quoteLogId: string | null = null;

  try {
    const raw = await req.json().catch(() => null);

    const parsed = Req.safeParse(raw);
    if (!parsed.success) {
      return json(
        { ok: false, error: "BAD_REQUEST_VALIDATION", issues: parsed.error.issues, received: raw },
        400,
        debugId
      );
    }

    const { tenantSlug, images, customer_context } = parsed.data;

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return json(
        { ok: false, error: "TENANT_NOT_FOUND", message: `No tenant found: ${tenantSlug}` },
        404,
        debugId
      );
    }

    const tenantId = (tenant as any).id as string;

    const openAiKey = await getTenantOpenAiKey(tenantId);
    if (!openAiKey) {
      return json(
        {
          ok: false,
          error: "OPENAI_KEY_MISSING",
          message: "Tenant OpenAI key not configured in tenant_secrets.openai_key_enc.",
        },
        500,
        debugId
      );
    }

    const tenantEmailSettings = await getTenantEmailSettings(tenantId);
    const pricingRules = await getTenantPricingRules(tenantId);

    // Preflight images
    const checks = await Promise.all(images.map((i) => preflightImageUrl(i.url)));
    const bad = checks.filter((c) => !c.ok);
    if (bad.length) {
      return json(
        {
          ok: false,
          error: "IMAGE_URL_NOT_FETCHABLE",
          message: "One or more image URLs cannot be fetched publicly from the server.",
          bad,
        },
        400,
        debugId
      );
    }

    // Insert quote log
    try {
      quoteLogId = await insertQuoteLog(tenantId, raw);
    } catch (e: any) {
      const dbErr = normalizeDbErr(e);
      return json(
        { ok: false, error: "QUOTE_LOG_INSERT_FAILED", message: dbErr.message, dbErr },
        500,
        debugId
      );
    }

    const notes = customer_context?.notes?.trim();
    const serviceType = customer_context?.service_type?.trim();
    const category = customer_context?.category?.trim();

    const promptLines = [
      "You are an expert marine + auto upholstery estimator.",
      "Return ONLY valid JSON with:",
      `confidence: "high"|"medium"|"low"`,
      "inspection_required: boolean",
      "summary: string",
      "visible_scope: string[]",
      "assumptions: string[]",
      "questions: string[]",
      "",
      "Rules:",
      "- If anything is unclear from photos, set inspection_required=true and add questions.",
      "- Be practical and shop-accurate; avoid wild guesses.",
    ];
    if (category) promptLines.push(`Category: ${category}`);
    if (serviceType) promptLines.push(`Service type: ${serviceType}`);
    if (notes) promptLines.push(`Customer notes: ${notes}`);

    const openai = new OpenAI({ apiKey: openAiKey });

    const content = [
      { type: "input_text" as const, text: promptLines.join("\n") },
      ...images.map((img) => ({
        type: "input_image" as const,
        image_url: img.url,
        detail: "auto" as const,
      })),
    ];

    const r = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [{ role: "user", content }],
      text: { format: { type: "json_object" } },
    });

    const rawText = r.output_text?.trim() || "";

    let structured: z.infer<typeof QuoteAssessmentSchema> | null = null;
    try {
      const obj = JSON.parse(rawText);
      const validated = QuoteAssessmentSchema.safeParse(obj);
      structured = validated.success ? validated.data : null;
    } catch {}

    const finalAssessment =
      structured ?? { rawText, parse_warning: "Model did not return valid JSON per schema." };

    // ✅ compute pricing (only if assessment validated + rules exist)
    const estimate =
      structured
        ? priceFromRules({
            rules: pricingRules,
            confidence: structured.confidence,
            inspection_required: structured.inspection_required,
          })
        : null;

    // normalized output for the public flow (stable shape)
    const output =
      structured
        ? {
            confidence: structured.confidence,
            inspection_required: structured.inspection_required,
            summary: structured.summary,
            questions: structured.questions ?? [],
            estimate: estimate ?? null,
          }
        : null;

    const customer = {
      name: customer_context?.name,
      email: customer_context?.email,
      phone: customer_context?.phone,
    };

    // Send emails
    const emailResult = await sendEmailsIfConfigured({
      tenantSlug,
      quoteLogId,
      category,
      notes,
      images: images.map((i) => i.url),
      assessment: finalAssessment,
      estimate,
      customer,
      tenantEmailSettings,
    });

    // Persist output JSON + summary fields (best-effort)
    try {
      await updateQuoteLogOutput(quoteLogId, {
        status: "completed",
        output,
        assessment: finalAssessment,
        estimate,
        email: emailResult,
        meta: {
          tenantSlug,
          category,
          service_type: serviceType,
          durationMs: Date.now() - startedAt,
        },
      });

      if (structured) {
        await updateQuoteLogSummaryFields({
          quoteLogId,
          confidence: structured.confidence ?? null,
          inspectionRequired: structured.inspection_required ?? null,
          estimateLow: estimate?.low ?? null,
          estimateHigh: estimate?.high ?? null,
        });
      }
    } catch (e: any) {
      return json(
        {
          ok: true,
          quoteLogId,
          tenantId,
          imagePreflight: checks,
          assessment: finalAssessment,
          output,
          estimate,
          email: emailResult,
          warning: `quote_logs update failed: ${normalizeDbErr(e).message}`,
          durationMs: Date.now() - startedAt,
        },
        200,
        debugId
      );
    }

    return json(
      {
        ok: true,
        quoteLogId,
        tenantId,
        imagePreflight: checks,
        assessment: finalAssessment,
        output,   // ✅ what QuoteForm wants
        estimate, // ✅ explicit too
        email: emailResult,
        durationMs: Date.now() - startedAt,
      },
      200,
      debugId
    );
  } catch (err: any) {
    const e = normalizeErr(err);

    try {
      if (quoteLogId) {
        await updateQuoteLogOutput(quoteLogId, { status: "error", error: e });
      }
    } catch {}

    return json({ ok: false, error: "REQUEST_FAILED", ...e }, e.status ?? 500, debugId);
  }
}
