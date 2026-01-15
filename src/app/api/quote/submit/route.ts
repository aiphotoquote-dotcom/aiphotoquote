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

  // ✅ customer opt-in (only honored if tenant enabled)
  render_opt_in: z.boolean().optional().default(false),
});

const QuoteOutputSchema = z.object({
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

// ✅ tenant_settings: ai_rendering_enabled (boolean)
async function getTenantRenderingPolicy(tenantId: string) {
  const r = await db.execute(sql`
    select ai_rendering_enabled
    from tenant_settings
    where tenant_id = ${tenantId}
    limit 1
  `);
  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

  return {
    aiRenderingEnabled: row?.ai_rendering_enabled === true,
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

/**
 * quote_logs columns (expanded):
 * id, tenant_id, input, output,
 * render_opt_in, render_status, render_image_url, render_prompt, render_error, rendered_at,
 * created_at
 */
async function insertQuoteLog(args: {
  tenantId: string;
  inputJson: any;
  renderOptIn: boolean;
  renderStatus: "not_requested" | "queued" | "rendered" | "failed";
}) {
  const quoteLogId = crypto.randomUUID();
  const inputStr = JSON.stringify(args.inputJson ?? {});
  const outputStr = JSON.stringify({ status: "started" });

  await db.execute(sql`
    insert into quote_logs (
      id, tenant_id, input, output,
      render_opt_in, render_status,
      created_at
    )
    values (
      ${quoteLogId}::uuid, ${args.tenantId},
      ${inputStr}::jsonb, ${outputStr}::jsonb,
      ${args.renderOptIn}, ${args.renderStatus},
      now()
    )
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

async function updateQuoteLogRendering(quoteLogId: string, patch: any) {
  const {
    render_status,
    render_opt_in,
    render_prompt,
    render_image_url,
    render_error,
    rendered_at,
  } = patch ?? {};

  await db.execute(sql`
    update quote_logs
    set
      render_status = coalesce(${render_status}, render_status),
      render_opt_in = coalesce(${render_opt_in}, render_opt_in),
      render_prompt = coalesce(${render_prompt}, render_prompt),
      render_image_url = coalesce(${render_image_url}, render_image_url),
      render_error = coalesce(${render_error}, render_error),
      rendered_at = coalesce(${rendered_at}, rendered_at)
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
  rendering?: { requested: boolean; allowed: boolean; status: string; imageUrl?: string | null };
}) {
  const { tenantSlug, quoteLogId, customer, category, notes, images, assessment, rendering } = args;

  const imgs = images
    .map(
      (u) =>
        `<div style="margin:10px 0;"><a href="${esc(u)}">${esc(u)}</a><br/><img src="${esc(
          u
        )}" alt="uploaded photo" style="max-width:560px;width:100%;border-radius:10px;border:1px solid #e5e7eb"/></div>`
    )
    .join("");

  const renderBlock =
    rendering?.requested
      ? `
    <h3 style="margin:18px 0 6px;">AI Rendering (optional)</h3>
    <div style="color:#374151;">
      <div><b>Requested</b>: ${rendering.requested ? "yes" : "no"}</div>
      <div><b>Allowed</b>: ${rendering.allowed ? "yes" : "no"}</div>
      <div><b>Status</b>: ${esc(rendering.status)}</div>
      ${
        rendering.imageUrl
          ? `<div style="margin-top:10px;"><a href="${esc(rendering.imageUrl)}">${esc(
              rendering.imageUrl
            )}</a><br/><img src="${esc(
              rendering.imageUrl
            )}" alt="AI concept rendering" style="max-width:560px;width:100%;border-radius:10px;border:1px solid #e5e7eb"/></div>`
          : ""
      }
    </div>
    `
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

    ${renderBlock}
  </div>`;
}

function renderCustomerEmailHTML(args: {
  businessName: string;
  quoteLogId: string;
  notes?: string;
  images: string[];
  assessment: any;
  rendering?: { requested: boolean; allowed: boolean; status: string; imageUrl?: string | null };
}) {
  const { businessName, quoteLogId, notes, images, assessment, rendering } = args;

  const imgs = images
    .map(
      (u) =>
        `<div style="margin:10px 0;"><img src="${esc(
          u
        )}" alt="uploaded photo" style="max-width:560px;width:100%;border-radius:10px;border:1px solid #e5e7eb;border-radius:10px"/></div>`
    )
    .join("");

  const renderBlock =
    rendering?.requested
      ? `
    <h3 style="margin:18px 0 6px;">AI Concept Rendering (optional)</h3>
    <div style="color:#374151;">
      <div><b>Status</b>: ${esc(rendering.status)}</div>
      ${
        rendering.imageUrl
          ? `<div style="margin-top:10px;"><img src="${esc(
              rendering.imageUrl
            )}" alt="AI concept rendering" style="max-width:560px;width:100%;border-radius:10px;border:1px solid #e5e7eb"/></div>`
          : `<div style="margin-top:8px;color:#6b7280;">If selected, we may send a concept image in a follow-up message.</div>`
      }
    </div>
    `
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

    ${renderBlock}

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
  rendering?: { requested: boolean; allowed: boolean; status: string; imageUrl?: string | null };
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

function buildRenderPrompt(args: {
  category?: string;
  serviceType?: string;
  notes?: string;
  assessment: any;
}) {
  const category = args.category ?? "unknown";
  const serviceType = args.serviceType ?? "";
  const notes = args.notes ?? "";
  const summary = typeof args.assessment?.summary === "string" ? args.assessment.summary : "";
  const visibleScope = Array.isArray(args.assessment?.visible_scope)
    ? args.assessment.visible_scope
    : [];

  const lines = [
    "Create a photorealistic concept rendering of the finished, restored item described below.",
    "This is a conceptual 'after' image, not an exact preview or guarantee.",
    "",
    `Category: ${category}`,
    serviceType ? `Service type: ${serviceType}` : "",
    notes ? `Customer notes: ${notes}` : "",
    "",
    summary ? `Assessment summary: ${summary}` : "",
    visibleScope.length ? `Visible scope: ${visibleScope.join(", ")}` : "",
    "",
    "Style guidance:",
    "- Clean professional product photo look",
    "- Neutral background",
    "- Natural lighting",
    "- Realistic materials and stitching",
    "- No text overlays or watermarks",
  ];

  return lines.filter(Boolean).join("\n");
}

async function generateConceptRendering(args: {
  openAiKey: string;
  prompt: string;
}) {
  const openai = new OpenAI({ apiKey: args.openAiKey });

  // Note: images.generate response format can vary by model/sdk version.
  // We try url first; if only base64 is returned, we throw a clear error
  // so you can decide where to store it (blob) later without re-architecture.
  const img: any = await openai.images.generate({
    model: "gpt-image-1",
    prompt: args.prompt,
    size: "1024x1024",
  });

  const first = img?.data?.[0];
  const url = first?.url ?? null;

  if (!url) {
    // Some responses may return base64 in b64_json; we intentionally don't persist it here.
    // That would require a storage decision (blob), which you said not to re-architect.
    const hasB64 = Boolean(first?.b64_json);
    throw new Error(
      hasB64
        ? "Image API returned base64 (b64_json) but no URL. Storage is required to persist it."
        : "Image API returned no image URL."
    );
  }

  return { url };
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

    const { tenantSlug, images, customer_context, render_opt_in } = parsed.data;

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

    // Pull tenant email identity + routing
    const tenantEmailSettings = await getTenantEmailSettings(tenantId);

    // Pull tenant rendering policy (tenant-controlled)
    const renderingPolicy = await getTenantRenderingPolicy(tenantId);

    const renderRequested = render_opt_in === true;
    const renderingAllowed = renderingPolicy.aiRenderingEnabled === true && renderRequested === true;

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

    // Insert quote log (now includes rendering fields)
    try {
      quoteLogId = await insertQuoteLog({
        tenantId,
        inputJson: raw,
        renderOptIn: renderRequested,
        renderStatus: renderingAllowed ? "queued" : "not_requested",
      });
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

    let structured: z.infer<typeof QuoteOutputSchema> | null = null;
    try {
      const obj = JSON.parse(rawText);
      const validated = QuoteOutputSchema.safeParse(obj);
      structured = validated.success ? validated.data : null;
    } catch {}

    const finalAssessment =
      structured ?? { rawText, parse_warning: "Model did not return valid JSON per schema." };

    // --- Rendering (2nd step; optional; tenant enabled + customer opted in) ---
    const renderingResult: {
      requested: boolean;
      allowed: boolean;
      status: "not_requested" | "queued" | "rendered" | "failed";
      imageUrl: string | null;
      error: string | null;
    } = {
      requested: renderRequested,
      allowed: renderingAllowed,
      status: renderingAllowed ? "queued" : "not_requested",
      imageUrl: null,
      error: null,
    };

    if (renderingAllowed && quoteLogId) {
      try {
        const renderPrompt = buildRenderPrompt({
          category,
          serviceType,
          notes,
          assessment: finalAssessment,
        });

        // Persist prompt + queued
        await updateQuoteLogRendering(quoteLogId, {
          render_status: "queued",
          render_opt_in: true,
          render_prompt: renderPrompt,
          render_error: null,
        });

        const img = await generateConceptRendering({
          openAiKey,
          prompt: renderPrompt,
        });

        renderingResult.status = "rendered";
        renderingResult.imageUrl = img.url;

        await updateQuoteLogRendering(quoteLogId, {
          render_status: "rendered",
          render_image_url: img.url,
          render_error: null,
          rendered_at: new Date(),
        });
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        renderingResult.status = "failed";
        renderingResult.error = msg;

        try {
          await updateQuoteLogRendering(quoteLogId, {
            render_status: "failed",
            render_error: msg,
          });
        } catch {}
      }
    }

    const customer = {
      name: customer_context?.name,
      email: customer_context?.email,
      phone: customer_context?.phone,
    };

    // Send emails using tenant settings (non-blocking)
    const emailResult = await sendEmailsIfConfigured({
      tenantSlug,
      quoteLogId: quoteLogId!,
      category,
      notes,
      images: images.map((i) => i.url),
      assessment: finalAssessment,
      rendering: {
        requested: renderingResult.requested,
        allowed: renderingResult.allowed,
        status: renderingResult.status,
        imageUrl: renderingResult.imageUrl,
      },
      customer,
      tenantEmailSettings,
    });

    // Persist output
    try {
      await updateQuoteLogOutput(quoteLogId!, {
        status: "completed",
        assessment: finalAssessment,
        rendering: renderingResult,
        email: emailResult,
        meta: {
          tenantSlug,
          category,
          service_type: serviceType,
          durationMs: Date.now() - startedAt,
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
          rendering: renderingResult,
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
        rendering: renderingResult,
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
