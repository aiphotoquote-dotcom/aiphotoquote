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
  render_opt_in: z.boolean().optional(),
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

// tenant_secrets: tenant_id (pk), openai_key_enc text, ...
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

/**
 * Tenant toggle: auto_estimate_enabled
 * - If column exists: use it
 * - If not yet migrated: default true
 */
async function getTenantAutoEstimateEnabled(tenantId: string): Promise<boolean> {
  try {
    const r = await db.execute(sql`
      select auto_estimate_enabled
      from tenant_settings
      where tenant_id = ${tenantId}
      limit 1
    `);
    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
    return row?.auto_estimate_enabled === false ? false : true;
  } catch {
    return true;
  }
}

/**
 * Tenant toggle: ai_rendering_enabled
 * - If column exists: use it
 * - If not yet migrated: default false (safer)
 */
async function getTenantAiRenderingEnabled(tenantId: string): Promise<boolean> {
  try {
    const r = await db.execute(sql`
      select ai_rendering_enabled
      from tenant_settings
      where tenant_id = ${tenantId}
      limit 1
    `);
    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
    return row?.ai_rendering_enabled === true ? true : false;
  } catch {
    return false;
  }
}

/**
 * Latest tenant pricing rules (if configured)
 */
async function getTenantPricingRules(tenantId: string) {
  try {
    const r = await db.execute(sql`
      select
        id,
        min_job,
        typical_low,
        typical_high,
        max_without_inspection,
        tone,
        risk_posture,
        always_estimate_language,
        created_at
      from tenant_pricing_rules
      where tenant_id = ${tenantId}
      order by created_at desc
      limit 1
    `);

    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
    if (!row) return null;

    return {
      id: String(row.id),
      minJob: row.min_job == null ? null : Number(row.min_job),
      typicalLow: row.typical_low == null ? null : Number(row.typical_low),
      typicalHigh: row.typical_high == null ? null : Number(row.typical_high),
      maxWithoutInspection: row.max_without_inspection == null ? null : Number(row.max_without_inspection),
      tone: row.tone ?? null,
      riskPosture: row.risk_posture ?? null,
      alwaysEstimateLanguage: row.always_estimate_language === false ? false : true,
    };
  } catch {
    return null;
  }
}

function roundTo10(n: number) {
  return Math.round(n / 10) * 10;
}

function estimateFromRules(args: {
  rules: {
    id: string;
    minJob: number | null;
    typicalLow: number | null;
    typicalHigh: number | null;
    maxWithoutInspection: number | null;
    alwaysEstimateLanguage: boolean;
  } | null;
  confidence: "high" | "medium" | "low";
  inspectionRequired: boolean;
}) {
  const { rules, confidence, inspectionRequired } = args;

  const minJob = rules?.minJob ?? 250;
  const typicalLow = rules?.typicalLow ?? Math.max(minJob, 500);
  const typicalHigh = rules?.typicalHigh ?? Math.max(typicalLow + 300, typicalLow * 1.6);
  const maxNoInspect = rules?.maxWithoutInspection ?? null;

  let low = typicalLow;
  let high = typicalHigh;

  if (confidence === "high") {
    low *= 0.95;
    high *= 1.05;
  } else if (confidence === "medium") {
    low *= 0.9;
    high *= 1.15;
  } else {
    low *= 0.85;
    high *= 1.3;
  }

  if (inspectionRequired) {
    low *= 0.95;
    high *= 1.1;
    if (maxNoInspect != null) {
      high = Math.min(high, maxNoInspect);
    }
  } else {
    if (maxNoInspect != null) {
      high = Math.min(high, maxNoInspect);
    }
  }

  low = Math.max(low, minJob);
  high = Math.max(high, low + 50);

  low = roundTo10(low);
  high = roundTo10(high);

  return {
    currency: "USD" as const,
    low,
    high,
    method: rules ? "tenant_pricing_rules" : "default_rules",
    pricing_rule_id: rules?.id ?? null,
    inspection_required: inspectionRequired,
    confidence,
    note: inspectionRequired
      ? "Estimate is preliminary; inspection recommended to confirm scope."
      : "Estimate is preliminary; final price may change after inspection/material selection.",
    always_estimate_language: rules?.alwaysEstimateLanguage ?? true,
  };
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

async function tryUpdateQuoteLogScalars(args: {
  quoteLogId: string;
  confidence: "high" | "medium" | "low" | null;
  inspectionRequired: boolean | null;
  estimateLow: number | null;
  estimateHigh: number | null;
}) {
  const { quoteLogId, confidence, inspectionRequired, estimateLow, estimateHigh } = args;

  try {
    await db.execute(sql`
      update quote_logs
      set
        confidence = ${confidence},
        inspection_required = ${inspectionRequired},
        estimate_low = ${estimateLow},
        estimate_high = ${estimateHigh}
      where id = ${quoteLogId}::uuid
    `);
  } catch {
    // ignore if columns don't exist
  }
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
  estimate: any;
  rendering: any;
}) {
  const { tenantSlug, quoteLogId, customer, category, notes, images, assessment, estimate, rendering } = args;

  const imgs = images
    .map(
      (u) =>
        `<div style="margin:10px 0;"><a href="${esc(u)}">${esc(u)}</a><br/><img src="${esc(
          u
        )}" alt="uploaded photo" style="max-width:560px;width:100%;border-radius:10px;border:1px solid #e5e7eb"/></div>`
    )
    .join("");

  const estBlock = estimate
    ? `<h3 style="margin:18px 0 6px;">Estimate</h3>
       <pre style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:12px;white-space:pre-wrap;">${esc(
         JSON.stringify(estimate, null, 2)
       )}</pre>`
    : "";

  const renderBlock = rendering
    ? `<h3 style="margin:18px 0 6px;">Rendering (opt-in)</h3>
       <pre style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:12px;white-space:pre-wrap;">${esc(
         JSON.stringify(rendering, null, 2)
       )}</pre>`
    : "";

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.4;color:#111;">
    <h2 style="margin:0 0 8px;">New Photo Quote</h2>
    <div style="margin:0 0 12px;color:#374151;">
      <div><b>Tenant</b>: ${esc(tenantSlug)}</div>
      <div><b>Quote Log ID</b>: ${esc(quoteLogId)}</div>
      <div><b>Category</b>: ${esc(category || "")}</div>
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

    ${estBlock}
    ${renderBlock}
  </div>`;
}

function renderCustomerEmailHTML(args: {
  businessName: string;
  quoteLogId: string;
  notes?: string;
  images: string[];
  assessment: any;
  estimate: any;
  rendering: any;
}) {
  const { businessName, quoteLogId, notes, images, assessment, estimate, rendering } = args;

  const imgs = images
    .map(
      (u) =>
        `<div style="margin:10px 0;"><img src="${esc(
          u
        )}" alt="uploaded photo" style="max-width:560px;width:100%;border-radius:10px;border:1px solid #e5e7eb;border-radius:10px"/></div>`
    )
    .join("");

  const estBlock = estimate
    ? `<h3 style="margin:18px 0 6px;">Estimate</h3>
       <pre style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:12px;white-space:pre-wrap;">${esc(
         JSON.stringify(estimate, null, 2)
       )}</pre>`
    : `<p style="color:#6b7280;margin-top:14px;">We’ll follow up with pricing after review.</p>`;

  const renderLine =
    rendering?.requested === true
      ? `<p style="color:#374151;margin-top:10px;"><b>Optional:</b> You opted in to an AI concept rendering (if available). This may be delivered after review.</p>`
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

    ${estBlock}
    ${renderLine}

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
  estimate: any;
  rendering: any;
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
      rendering: args.rendering,
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

  // Customer receipt
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
        rendering: args.rendering,
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
    const requestedRenderOptIn = parsed.data.render_opt_in === true;

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

    const autoEstimateEnabled = await getTenantAutoEstimateEnabled(tenantId);
    const tenantRenderingEnabled = await getTenantAiRenderingEnabled(tenantId);

    // Effective opt-in must be tenant enabled AND customer opted in
    const renderOptIn = tenantRenderingEnabled && requestedRenderOptIn;

    // Pull tenant email identity + routing
    const tenantEmailSettings = await getTenantEmailSettings(tenantId);

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

    // Pricing
    let estimate: any = null;
    if (autoEstimateEnabled && structured) {
      const rules = await getTenantPricingRules(tenantId);
      estimate = estimateFromRules({
        rules,
        confidence: structured.confidence,
        inspectionRequired: structured.inspection_required,
      });
    }

    // Persist scalar columns if available
    if (structured) {
      await tryUpdateQuoteLogScalars({
        quoteLogId,
        confidence: structured.confidence,
        inspectionRequired: structured.inspection_required,
        estimateLow: typeof estimate?.low === "number" ? estimate.low : null,
        estimateHigh: typeof estimate?.high === "number" ? estimate.high : null,
      });
    }

    const rendering = {
      tenant_enabled: tenantRenderingEnabled,
      requested: renderOptIn,
      status: renderOptIn ? "queued" : "not_requested",
      // second-step: no image yet
      imageUrl: null as string | null,
    };

    const customer = {
      name: customer_context?.name,
      email: customer_context?.email,
      phone: customer_context?.phone,
    };

    // Send emails (include rendering metadata)
    const emailResult = await sendEmailsIfConfigured({
      tenantSlug,
      quoteLogId,
      category,
      notes,
      images: images.map((i) => i.url),
      assessment: finalAssessment,
      estimate,
      rendering,
      customer,
      tenantEmailSettings,
    });

    // Persist output json (includes rendering)
    try {
      await updateQuoteLogOutput(quoteLogId, {
        status: "completed",
        assessment: finalAssessment,
        estimate,
        rendering,
        email: emailResult,
        meta: {
          tenantSlug,
          category,
          service_type: serviceType,
          durationMs: Date.now() - startedAt,
          auto_estimate_enabled: autoEstimateEnabled,
        },
      });
    } catch (e: any) {
      return json(
        {
          ok: true,
          quoteLogId,
          tenantId,
          imagePreflight: checks,
          assessment: finalAssessment,
          estimate,
          rendering,
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
        estimate,
        rendering,
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
