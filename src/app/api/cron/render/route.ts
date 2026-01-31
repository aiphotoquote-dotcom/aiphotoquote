import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import crypto from "crypto";
import OpenAI from "openai";
import { Resend } from "resend";
import { put } from "@vercel/blob";

import { db } from "@/lib/db/client";
import { decryptSecret } from "@/lib/crypto";

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

function esc(s: unknown) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeName(name: string) {
  return (name || "render")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 180);
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

async function getTenantEmailSettings(tenantId: string) {
  const r = await db.execute(sql`
    select business_name, lead_to_email, resend_from_email
    from tenant_settings
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);
  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

  return {
    businessName: row?.business_name ?? null,
    leadToEmail: row?.lead_to_email ?? null,
    resendFromEmail: row?.resend_from_email ?? null,
  };
}

async function insertEmailDelivery(args: {
  tenantId: string;
  quoteLogId: string;
  type: string;
  to: any;
  from: string;
  provider?: string | null;
}) {
  const id = crypto.randomUUID();
  await db.execute(sql`
    insert into email_deliveries (id, tenant_id, quote_log_id, type, "to", "from", provider, status, created_at)
    values (
      ${id}::uuid,
      ${args.tenantId}::uuid,
      ${args.quoteLogId}::uuid,
      ${args.type},
      ${JSON.stringify(args.to)}::jsonb,
      ${args.from},
      ${args.provider ?? null},
      'queued',
      now()
    )
  `);
  return id;
}

async function markEmailDeliverySent(args: { id: string; providerMessageId?: string | null }) {
  await db.execute(sql`
    update email_deliveries
    set
      status = 'sent',
      provider_message_id = ${args.providerMessageId ?? null},
      sent_at = now(),
      error = null
    where id = ${args.id}::uuid
  `);
}

async function markEmailDeliveryFailed(args: { id: string; error: string }) {
  await db.execute(sql`
    update email_deliveries
    set
      status = 'failed',
      error = ${args.error},
      sent_at = null
    where id = ${args.id}::uuid
  `);
}

function renderLeadRenderEmailHTML(args: {
  tenantSlug: string;
  quoteLogId: string;
  customer: { name?: string; email?: string; phone?: string };
  images: string[];
  renderImageUrl: string;
}) {
  const { tenantSlug, quoteLogId, customer, images, renderImageUrl } = args;

  const imgs = images
    .map(
      (u) =>
        `<div style="margin:10px 0;"><a href="${esc(u)}">${esc(u)}</a><br/><img src="${esc(
          u
        )}" alt="uploaded photo" style="max-width:560px;width:100%;border-radius:10px;border:1px solid #e5e7eb"/></div>`
    )
    .join("");

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.4;color:#111;">
    <h2 style="margin:0 0 8px;">AI Render Complete</h2>
    <div style="margin:0 0 12px;color:#374151;">
      <div><b>Tenant</b>: ${esc(tenantSlug)}</div>
      <div><b>Quote Log ID</b>: ${esc(quoteLogId)}</div>
    </div>

    <h3 style="margin:18px 0 6px;">Customer</h3>
    <div style="color:#374151;">
      <div><b>Name</b>: ${esc(customer.name || "")}</div>
      <div><b>Email</b>: ${esc(customer.email || "")}</div>
      <div><b>Phone</b>: ${esc(customer.phone || "")}</div>
    </div>

    <h3 style="margin:18px 0 6px;">Rendered Preview</h3>
    <div style="margin:10px 0;">
      <a href="${esc(renderImageUrl)}">${esc(renderImageUrl)}</a><br/>
      <img src="${esc(
        renderImageUrl
      )}" alt="rendered preview" style="max-width:560px;width:100%;border-radius:10px;border:1px solid #e5e7eb"/>
    </div>

    <h3 style="margin:18px 0 6px;">Original Photos</h3>
    ${imgs}
  </div>`;
}

function renderCustomerRenderEmailHTML(args: {
  businessName: string;
  quoteLogId: string;
  renderImageUrl: string;
}) {
  const { businessName, quoteLogId, renderImageUrl } = args;

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.4;color:#111;">
    <h2 style="margin:0 0 8px;">Your AI Preview is Ready</h2>
    <div style="margin:0 0 12px;color:#374151;">
      <div><b>Quote ID</b>: ${esc(quoteLogId)}</div>
    </div>

    <p style="color:#374151;margin:0 0 10px;">
      Here’s an optional concept preview based on your photos. This is a visual mockup — final results depend on materials, inspection, and scope.
    </p>

    <div style="margin:10px 0;">
      <img src="${esc(
        renderImageUrl
      )}" alt="rendered preview" style="max-width:560px;width:100%;border-radius:10px;border:1px solid #e5e7eb"/>
    </div>

    <p style="color:#6b7280;margin-top:14px;">
      — ${esc(businessName)}
    </p>
  </div>`;
}

/**
 * Safely merge rendering info into quote_logs.output as JSONB.
 * (We do not require render_* columns to exist.)
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
 * Claim exactly one queued job using SKIP LOCKED.
 * This prevents multiple cron invocations from rendering the same quote.
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

async function loadQuoteInputForRender(quoteLogId: string) {
  const r = await db.execute(sql`
    select input, tenant_id
    from quote_logs
    where id = ${quoteLogId}::uuid
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  if (!row) return null;

  const input = safeJsonParse(row.input) ?? {};
  const images: string[] = Array.isArray(input?.images)
    ? input.images.map((x: any) => x?.url).filter(Boolean)
    : [];

  // Support BOTH shapes:
  //  - input.customer_context.{name,email,phone}
  //  - input.contact.{name,email,phone}  (your newer UI used this)
  const cc = input?.customer_context ?? {};
  const contact = input?.contact ?? {};

  const customer = {
    name: (cc?.name ?? contact?.name ?? "").toString() || undefined,
    email: (cc?.email ?? contact?.email ?? "").toString() || undefined,
    phone: (cc?.phone ?? contact?.phone ?? "").toString() || undefined,
  };

  return {
    tenantId: String(row.tenant_id),
    images,
    input,
    customer,
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

async function generateRenderPngBytes(args: { openaiKey: string; prompt: string }) {
  const openai = new OpenAI({ apiKey: args.openaiKey });

  // Request a manageable size so we don’t create giant payloads.
  const img = await openai.images.generate({
    model: "gpt-image-1",
    prompt: args.prompt,
    size: "1024x1024",
  } as any);

  const first: any = (img as any)?.data?.[0] ?? null;
  const b64 = first?.b64_json ? String(first.b64_json) : null;
  const url = first?.url ? String(first.url) : null;

  if (b64) {
    return Buffer.from(b64, "base64");
  }

  // Some configs return a URL. If so, fetch and return bytes.
  if (url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Failed to download OpenAI image url (HTTP ${r.status})`);
    const ab = await r.arrayBuffer();
    return Buffer.from(ab);
  }

  throw new Error("OpenAI image response missing b64_json/url");
}

async function sendRenderEmails(args: {
  tenantSlug: string;
  tenantId: string;
  quoteLogId: string;
  renderImageUrl: string;
  originalImages: string[];
  customer: { name?: string; email?: string; phone?: string };
}) {
  const resendKey = process.env.RESEND_API_KEY || "";
  if (!resendKey) {
    return { configured: false, skipped: true, reason: "RESEND_API_KEY missing" };
  }

  const { businessName, leadToEmail, resendFromEmail } = await getTenantEmailSettings(args.tenantId);

  const configured = Boolean(businessName && leadToEmail && resendFromEmail);
  if (!configured) {
    return {
      configured: false,
      skipped: true,
      reason: "tenant_settings missing business_name/lead_to_email/resend_from_email",
      missing: {
        business_name: !businessName,
        lead_to_email: !leadToEmail,
        resend_from_email: !resendFromEmail,
      },
    };
  }

  const resend = new Resend(resendKey);

  const result: any = {
    configured: true,
    lead: { attempted: false, sent: false, id: null as string | null, error: null as string | null },
    customer: { attempted: false, sent: false, id: null as string | null, error: null as string | null },
  };

  // Lead render email
  const leadDeliveryId = await insertEmailDelivery({
    tenantId: args.tenantId,
    quoteLogId: args.quoteLogId,
    type: "render.lead",
    to: [leadToEmail],
    from: resendFromEmail,
    provider: "resend",
  });

  try {
    result.lead.attempted = true;

    const leadHtml = renderLeadRenderEmailHTML({
      tenantSlug: args.tenantSlug,
      quoteLogId: args.quoteLogId,
      customer: args.customer,
      images: args.originalImages,
      renderImageUrl: args.renderImageUrl,
    });

    const leadRes = await resend.emails.send({
      from: resendFromEmail!,
      to: [leadToEmail!],
      subject: `AI Render Ready — ${args.quoteLogId}`,
      html: leadHtml,
    });

    const msgId = (leadRes as any)?.data?.id ?? null;
    if ((leadRes as any)?.error) throw new Error((leadRes as any).error?.message ?? "Resend error");

    await markEmailDeliverySent({ id: leadDeliveryId, providerMessageId: msgId });
    result.lead.sent = true;
    result.lead.id = msgId;
  } catch (e: any) {
    const errMsg = e?.message ?? String(e);
    await markEmailDeliveryFailed({ id: leadDeliveryId, error: errMsg });
    result.lead.error = errMsg;
  }

  // Customer render email (if email provided)
  if (args.customer.email) {
    const custDeliveryId = await insertEmailDelivery({
      tenantId: args.tenantId,
      quoteLogId: args.quoteLogId,
      type: "render.customer",
      to: [args.customer.email],
      from: resendFromEmail!,
      provider: "resend",
    });

    try {
      result.customer.attempted = true;

      const custHtml = renderCustomerRenderEmailHTML({
        businessName: businessName!,
        quoteLogId: args.quoteLogId,
        renderImageUrl: args.renderImageUrl,
      });

      const custRes = await resend.emails.send({
        from: resendFromEmail!,
        to: [args.customer.email],
        subject: `Your AI preview is ready — Quote ${args.quoteLogId}`,
        html: custHtml,
      });

      const msgId = (custRes as any)?.data?.id ?? null;
      if ((custRes as any)?.error) throw new Error((custRes as any).error?.message ?? "Resend error");

      await markEmailDeliverySent({ id: custDeliveryId, providerMessageId: msgId });
      result.customer.sent = true;
      result.customer.id = msgId;
    } catch (e: any) {
      const errMsg = e?.message ?? String(e);
      await markEmailDeliveryFailed({ id: custDeliveryId, error: errMsg });
      result.customer.error = errMsg;
    }
  } else {
    result.customer.error = "No customer email present; skipping customer render email.";
  }

  return result;
}

function assertCronAuth(req: Request) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return { ok: true as const, mode: "no_secret_configured" as const };

  const h = req.headers;
  const token =
    h.get("x-cron-secret") ||
    h.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";

  if (token && token === secret) return { ok: true as const, mode: "header" as const };

  const url = new URL(req.url);
  const qs = url.searchParams.get("secret") || "";
  if (qs && qs === secret) return { ok: true as const, mode: "query" as const };

  return { ok: false as const };
}

export async function POST(req: Request) {
  const debugId = crypto.randomBytes(6).toString("hex");
  const startedAt = Date.now();

  // Protect cron endpoint
  const auth = assertCronAuth(req);
  if (!auth.ok) {
    return json({ ok: false, error: "UNAUTHORIZED" }, 401, debugId);
  }

  // Optional: allow ?max=3 to process a few jobs per invocation
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
    let errMsg: string | null = null;

    try {
      const quote = await loadQuoteInputForRender(job.quote_log_id);
      if (!quote) throw new Error("QUOTE_LOG_NOT_FOUND");

      // Ensure job tenant matches quote tenant (safety)
      if (String(quote.tenantId) !== String(job.tenant_id)) {
        throw new Error("TENANT_MISMATCH");
      }

      if (!quote.images.length) throw new Error("NO_IMAGES_ON_QUOTE_INPUT");

      const openaiKey = await getTenantOpenAiKey(job.tenant_id);
      if (!openaiKey) throw new Error("OPENAI_KEY_MISSING");

      const prompt = job.prompt || "";

      // Generate PNG bytes (b64 preferred; url fallback)
      const pngBytes = await generateRenderPngBytes({ openaiKey, prompt });

      // Upload to Vercel Blob (server-side put => no 413)
      const pathname = `renders/${safeName(`render-${job.quote_log_id}`)}-${Date.now()}.png`;
      imageUrl = await uploadRenderedPngToBlob({ pathname, bytes: pngBytes });

      // Update render_jobs
      await completeJob({ jobId: job.id, imageUrl, error: null });

      // Merge into quote_logs.output.rendering (portable, no schema drift issues)
      await mergeQuoteLogRendering({
        quoteLogId: job.quote_log_id,
        status: "rendered",
        imageUrl,
        error: null,
        prompt,
      });

      // Send emails + write email_deliveries
      const tenantSlugRow = await db.execute(sql`
        select slug from tenants where id = ${job.tenant_id}::uuid limit 1
      `);
      const t: any =
        (tenantSlugRow as any)?.rows?.[0] ?? (Array.isArray(tenantSlugRow) ? (tenantSlugRow as any)[0] : null);

      const tenantSlug = t?.slug ? String(t.slug) : "tenant";

      const emailRes = await sendRenderEmails({
        tenantSlug,
        tenantId: job.tenant_id,
        quoteLogId: job.quote_log_id,
        renderImageUrl: imageUrl,
        originalImages: quote.images,
        customer: quote.customer,
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
      errMsg = e?.message ?? String(e);

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
