// src/app/api/cron/render/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import crypto from "crypto";
import OpenAI from "openai";
import { put } from "@vercel/blob";

import { db } from "@/lib/db/client";
import { decryptSecret } from "@/lib/crypto";

// ✅ PCC + tenant overrides (model selection)
import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";
import { getTenantLlmOverrides } from "@/lib/pcc/llm/tenantStore";
import { normalizeTenantOverrides, type TenantLlmOverrides } from "@/lib/pcc/llm/tenantTypes";
import { buildEffectiveLlmConfig } from "@/lib/pcc/llm/effective";

// ✅ Render debug wiring (writes to output.render_debug fallback if columns don’t exist)
import { isRenderDebugEnabled, buildRenderDebugPayload } from "@/lib/pcc/render/debug";
import { setRenderDebug } from "@/lib/pcc/render/output";

// ✅ Email abstraction (enterprise vs standard lives here — do NOT bypass)
import { sendEmail } from "@/lib/email";
import { getTenantEmailConfig } from "@/lib/email/tenantEmail";
import { renderCustomerRenderCompleteEmailHTML } from "@/lib/email/templates/renderCompleteCustomer";
import { renderLeadRenderCompleteEmailHTML } from "@/lib/email/templates/renderCompleteLead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JobRow = {
  id: string;
  tenant_id: string;
  quote_log_id: string;
  status: string;
  prompt: string | null;
};

function json(data: any, status = 200, debugId?: string) {
  const res = NextResponse.json(debugId ? { debugId, ...data } : data, { status });
  if (debugId) res.headers.set("x-debug-id", debugId);
  return res;
}

function safeJsonParse(v: any) {
  try {
    if (v == null) return null;
    if (typeof v === "object") return v;
    if (typeof v === "string") return JSON.parse(v);
    return v;
  } catch {
    return null;
  }
}

function safeName(name: string) {
  return (name || "render")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 180);
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

async function getTenantOpenAiKey(tenantId: string): Promise<string | null> {
  const r = await db.execute(
    sql`select openai_key_enc from tenant_secrets where tenant_id = ${tenantId}::uuid limit 1`
  );
  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  const enc = row?.openai_key_enc ?? null;
  if (!enc) return null;
  return decryptSecret(enc);
}

/**
 * Claim exactly one queued job using SKIP LOCKED.
 */
async function claimOneQueuedJob(): Promise<JobRow | null> {
  const r = await db.execute(sql`
    with c as (
      select id
      from render_jobs
      where status = 'queued'
      order by created_at asc
      for update skip locked
      limit 1
    )
    update render_jobs
    set status = 'running',
        started_at = coalesce(started_at, now())
    where id in (select id from c)
    returning id, tenant_id, quote_log_id, status, prompt
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  if (!row) return null;

  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    quote_log_id: String(row.quote_log_id),
    status: String(row.status),
    prompt: row.prompt != null ? String(row.prompt) : null,
  };
}

async function completeJob(args: { jobId: string; imageUrl: string | null; error: string | null }) {
  await db.execute(sql`
    update render_jobs
    set
      status = ${args.error ? "failed" : "rendered"},
      image_url = ${args.imageUrl},
      error = ${args.error},
      completed_at = now()
    where id = ${args.jobId}::uuid
  `);
}

async function loadQuoteForRender(quoteLogId: string) {
  const r = await db.execute(sql`
    select input, output, tenant_id
    from quote_logs
    where id = ${quoteLogId}::uuid
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  if (!row) return null;

  const input = safeJsonParse(row.input) ?? {};
  const output = safeJsonParse(row.output) ?? {};

  const images: string[] = Array.isArray(input?.images)
    ? input.images.map((x: any) => x?.url).filter(Boolean)
    : [];

  // support both shapes (customer_context vs contact)
  const cc = input?.customer_context ?? {};
  const contact = input?.contact ?? {};
  const customer = input?.customer ?? null;

  const customerName =
    String(customer?.name ?? cc?.name ?? contact?.name ?? "Customer").trim() || "Customer";
  const customerEmail =
    String(customer?.email ?? cc?.email ?? contact?.email ?? "").trim().toLowerCase() || "";
  const customerPhone =
    String(customer?.phone ?? cc?.phone ?? contact?.phone ?? "").trim() || "";

  const estimateLow = typeof output?.estimate_low === "number" ? output.estimate_low : null;
  const estimateHigh = typeof output?.estimate_high === "number" ? output.estimate_high : null;
  const summary = typeof output?.summary === "string" ? output.summary : "";

  return {
    tenantId: String(row.tenant_id),
    input,
    output,
    images,
    customer: { name: customerName, email: customerEmail, phone: customerPhone },
    estimateLow,
    estimateHigh,
    summary,
  };
}

async function uploadRenderedPngToBlob(args: { pathname: string; bytes: Buffer }) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("Missing BLOB_READ_WRITE_TOKEN");

  const res = await put(args.pathname, args.bytes, {
    access: "public",
    contentType: "image/png",
    token,
  });

  return res.url;
}

async function generateRenderPngBytes(args: { openaiKey: string; prompt: string; model: string }) {
  const openai = new OpenAI({ apiKey: args.openaiKey });

  const img = await openai.images.generate({
    model: args.model,
    prompt: args.prompt,
    size: "1024x1024",
  } as any);

  const first: any = (img as any)?.data?.[0] ?? null;
  const b64 = first?.b64_json ? String(first.b64_json) : null;
  const url = first?.url ? String(first.url) : null;

  if (b64) return Buffer.from(b64, "base64");

  if (url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Failed to download OpenAI image url (HTTP ${r.status})`);
    const ab = await r.arrayBuffer();
    return Buffer.from(ab);
  }

  throw new Error("OpenAI image response missing b64_json/url");
}

/**
 * Merge render info into quote_logs.output.rendering
 * (portable: no render_* columns required)
 */
async function mergeQuoteLogRendering(args: {
  quoteLogId: string;
  status: "rendered" | "failed";
  imageUrl: string | null;
  error: string | null;
  prompt: string;
}) {
  const { quoteLogId, status, imageUrl, error, prompt } = args;

  const r = await db.execute(sql`
    select output
    from quote_logs
    where id = ${quoteLogId}::uuid
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  const out = safeJsonParse(row?.output) ?? {};

  const next = {
    ...out,
    rendering: {
      requested: true,
      status,
      imageUrl,
      prompt,
      error,
      renderedAt: new Date().toISOString(),
    },
  };

  await db.execute(sql`
    update quote_logs
    set output = coalesce(output, '{}'::jsonb) || ${JSON.stringify(next)}::jsonb
    where id = ${quoteLogId}::uuid
  `);
}

/**
 * Determine effective render model:
 * tenant override > platform PCC > default
 */
async function getEffectiveRenderModelForTenant(tenantId: string): Promise<string> {
  const platform = await loadPlatformLlmConfig();

  const tenantRow = await getTenantLlmOverrides(tenantId);
  const tenant: TenantLlmOverrides | null = tenantRow
    ? normalizeTenantOverrides({ models: tenantRow.models ?? {}, prompts: tenantRow.prompts ?? {} })
    : null;

  const merged = buildEffectiveLlmConfig({
    platform,
    industry: {},
    tenant,
  });

  const m = String(merged?.effective?.models?.renderModel ?? "").trim();
  return m || "gpt-image-1";
}

async function loadTenantBranding(tenantId: string) {
  // Optional columns; safe if missing (won’t throw if column doesn’t exist? it WILL throw)
  // So: read only the ones you KNOW exist, or wrap.
  try {
    const r = await db.execute(sql`
      select business_name, brand_logo_url, lead_to_email
      from tenant_settings
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);
    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
    return {
      businessName: row?.business_name ?? null,
      brandLogoUrl: row?.brand_logo_url ?? null,
      leadToEmail: row?.lead_to_email ?? null,
    };
  } catch {
    return { businessName: null, brandLogoUrl: null, leadToEmail: null };
  }
}

/**
 * Send “render complete” emails via sendEmail abstraction.
 * This preserves enterprise vs standard routing.
 */
async function sendRenderCompleteEmailsViaAbstraction(args: {
  req: Request;
  tenantId: string;
  tenantSlug: string;
  quoteLogId: string;
  renderImageUrl: string;
  customer: { name: string; email: string; phone: string };
  estimateLow: number | null;
  estimateHigh: number | null;
  summary: string;
}) {
  const cfg = await getTenantEmailConfig(args.tenantId);
  const branding = await loadTenantBranding(args.tenantId);

  const businessName = String(branding.businessName || cfg.businessName || "Your Business").trim();
  const brandLogoUrl = branding.brandLogoUrl ?? null;

  const baseUrl = getBaseUrl(args.req);
  const publicQuoteUrl = baseUrl ? `${baseUrl}/q/${encodeURIComponent(args.tenantSlug)}` : null;
  const adminQuoteUrl = baseUrl ? `${baseUrl}/admin/quotes/${encodeURIComponent(args.quoteLogId)}` : null;

  const result: any = {
    configured: Boolean(cfg.fromEmail),
    lead_render: { attempted: false, ok: false, id: null as string | null, error: null as string | null },
    customer_render: { attempted: false, ok: false, id: null as string | null, error: null as string | null },
  };

  if (!cfg.fromEmail) return result;

  // Lead
  if (cfg.leadToEmail) {
    try {
      result.lead_render.attempted = true;

      const htmlLead = renderLeadRenderCompleteEmailHTML({
        businessName,
        brandLogoUrl,
        quoteLogId: args.quoteLogId,
        tenantSlug: args.tenantSlug,
        customerName: args.customer.name,
        customerEmail: args.customer.email,
        customerPhone: args.customer.phone,
        renderImageUrl: args.renderImageUrl,
        estimateLow: args.estimateLow,
        estimateHigh: args.estimateHigh,
        summary: args.summary,
        adminQuoteUrl,
      });

      const r1 = await sendEmail({
        tenantId: args.tenantId,
        context: { type: "lead_render_complete", quoteLogId: args.quoteLogId },
        message: {
          from: cfg.fromEmail,
          to: [cfg.leadToEmail],
          replyTo: [cfg.leadToEmail],
          subject: `Render complete — ${args.customer.name}`,
          html: htmlLead,
        },
      });

      result.lead_render.ok = r1.ok;
      result.lead_render.id = r1.providerMessageId ?? null;
      result.lead_render.error = r1.error ?? null;
    } catch (e: any) {
      result.lead_render.error = e?.message ?? String(e);
    }
  }

  // Customer
  if (args.customer.email) {
    try {
      result.customer_render.attempted = true;

      const htmlCust = renderCustomerRenderCompleteEmailHTML({
        businessName,
        brandLogoUrl,
        customerName: args.customer.name,
        quoteLogId: args.quoteLogId,
        renderImageUrl: args.renderImageUrl,
        estimateLow: args.estimateLow,
        estimateHigh: args.estimateHigh,
        summary: args.summary,
        publicQuoteUrl,
        replyToEmail: cfg.leadToEmail ?? null,
      });

      const r2 = await sendEmail({
        tenantId: args.tenantId,
        context: { type: "customer_render_complete", quoteLogId: args.quoteLogId },
        message: {
          from: cfg.fromEmail,
          to: [args.customer.email],
          replyTo: cfg.leadToEmail ? [cfg.leadToEmail] : undefined,
          subject: `Your concept render is ready — ${businessName}`,
          html: htmlCust,
        },
      });

      result.customer_render.ok = r2.ok;
      result.customer_render.id = r2.providerMessageId ?? null;
      result.customer_render.error = r2.error ?? null;
    } catch (e: any) {
      result.customer_render.error = e?.message ?? String(e);
    }
  }

  return result;
}

function assertCronAuth(req: Request) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return { ok: true as const, mode: "no_secret_configured" as const };

  const h = req.headers;
  const token = h.get("x-cron-secret") || h.get("authorization")?.replace(/^Bearer\s+/i, "") || "";

  if (token && token === secret) return { ok: true as const, mode: "header" as const };

  const url = new URL(req.url);
  const qs = url.searchParams.get("secret") || "";
  if (qs && qs === secret) return { ok: true as const, mode: "query" as const };

  return { ok: false as const };
}

export async function POST(req: Request) {
  const debugId = crypto.randomBytes(6).toString("hex");
  const startedAt = Date.now();

  const auth = assertCronAuth(req);
  if (!auth.ok) return json({ ok: false, error: "UNAUTHORIZED" }, 401, debugId);

  const debugEnabled = isRenderDebugEnabled();

  const u = new URL(req.url);
  const max = Math.max(1, Math.min(5, Number(u.searchParams.get("max") || "1")));

  const processed: any[] = [];
  let claimed = 0;

  for (let i = 0; i < max; i++) {
    const job = await claimOneQueuedJob();
    if (!job) break;

    claimed++;
    const jobStart = Date.now();

    let imageUrl: string | null = null;

    try {
      const quote = await loadQuoteForRender(job.quote_log_id);
      if (!quote) throw new Error("QUOTE_LOG_NOT_FOUND");

      if (String(quote.tenantId) !== String(job.tenant_id)) throw new Error("TENANT_MISMATCH");
      if (!quote.images.length) throw new Error("NO_IMAGES_ON_QUOTE_INPUT");

      const openaiKey = await getTenantOpenAiKey(job.tenant_id);
      if (!openaiKey) throw new Error("OPENAI_KEY_MISSING");

      const prompt = job.prompt || "";
      if (!prompt) throw new Error("JOB_PROMPT_EMPTY");

      const renderModel = await getEffectiveRenderModelForTenant(job.tenant_id);

      // ✅ Write debug proof (portable: output.render_debug fallback)
      if (debugEnabled) {
        const dbg = buildRenderDebugPayload({
          debugId: `cron_${debugId}`,
          renderModel,
          tenantStyleKey: "",
          styleText: "",
          renderPromptPreamble: "",
          renderPromptTemplate: "",
          finalPrompt: prompt,
          serviceType: "",
          summary: quote.summary || "",
          customerNotes: "",
          tenantRenderNotes: "",
          images: quote.images.map((u) => ({ url: u })),
        });

        try {
          await setRenderDebug({
            db: db as any,
            quoteLogId: job.quote_log_id,
            tenantId: job.tenant_id,
            debug: dbg,
          });
        } catch {
          // best-effort only
        }
      }

      const pngBytes = await generateRenderPngBytes({ openaiKey, prompt, model: renderModel });

      const pathname = `renders/${safeName(`render-${job.quote_log_id}`)}-${Date.now()}.png`;
      imageUrl = await uploadRenderedPngToBlob({ pathname, bytes: pngBytes });

      await completeJob({ jobId: job.id, imageUrl, error: null });

      await mergeQuoteLogRendering({
        quoteLogId: job.quote_log_id,
        status: "rendered",
        imageUrl,
        error: null,
        prompt,
      });

      // tenant slug
      const tenantSlugRow = await db.execute(sql`
        select slug from tenants where id = ${job.tenant_id}::uuid limit 1
      `);
      const t: any =
        (tenantSlugRow as any)?.rows?.[0] ?? (Array.isArray(tenantSlugRow) ? (tenantSlugRow as any)[0] : null);
      const tenantSlug = t?.slug ? String(t.slug) : "tenant";

      // ✅ Emails via abstraction (preserves enterprise/standard)
      const emailRes = await sendRenderCompleteEmailsViaAbstraction({
        req,
        tenantId: job.tenant_id,
        tenantSlug,
        quoteLogId: job.quote_log_id,
        renderImageUrl: imageUrl,
        customer: quote.customer,
        estimateLow: quote.estimateLow,
        estimateHigh: quote.estimateHigh,
        summary: quote.summary,
      });

      processed.push({
        jobId: job.id,
        quoteLogId: job.quote_log_id,
        status: "rendered",
        imageUrl,
        email: emailRes,
        durationMs: Date.now() - jobStart,
      });
    } catch (e: any) {
      const errMsg = e?.message ?? String(e);

      try {
        await completeJob({ jobId: job.id, imageUrl: null, error: errMsg });
      } catch {}

      try {
        await mergeQuoteLogRendering({
          quoteLogId: job.quote_log_id,
          status: "failed",
          imageUrl: null,
          error: errMsg,
          prompt: job.prompt || "",
        });
      } catch {}

      processed.push({
        jobId: job.id,
        quoteLogId: job.quote_log_id,
        status: "failed",
        error: errMsg,
        durationMs: Date.now() - jobStart,
      });
    }
  }

  return json(
    {
      ok: true,
      authMode: (auth as any).mode ?? "unknown",
      claimed,
      processed,
      durationMs: Date.now() - startedAt,
    },
    200,
    debugId
  );
}