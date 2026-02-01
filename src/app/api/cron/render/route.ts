// src/app/api/cron/render/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import crypto from "crypto";
import OpenAI from "openai";
import { put } from "@vercel/blob";

import { db } from "@/lib/db/client";
import { decryptSecret } from "@/lib/crypto";

import { sendEmail } from "@/lib/email";
import { getTenantEmailConfig } from "@/lib/email/tenantEmail";
import { renderCustomerRenderCompleteEmailHTML } from "@/lib/email/templates/renderCompleteCustomer";
import { renderLeadRenderCompleteEmailHTML } from "@/lib/email/templates/renderCompleteLead";

import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";
import { isRenderDebugEnabled, buildRenderDebugPayload } from "@/lib/pcc/render/debug";
import { setRenderDebug, setRenderEmailResult } from "@/lib/pcc/render/output";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200, debugId?: string) {
  const res = NextResponse.json(debugId ? { debugId, ...data } : data, { status });
  if (debugId) res.headers.set("x-debug-id", debugId);
  return res;
}

function safeErr(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e ?? "Unknown error");
  return msg.slice(0, 2000);
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

async function requireCronSecret(req: Request) {
  const configured = String(process.env.CRON_SECRET ?? "").trim();
  const auth = String(req.headers.get("authorization") ?? "").trim();

  if (!configured) return { ok: true as const, mode: "no_secret_configured" as const };

  const expected = `Bearer ${configured}`;
  if (auth !== expected) return { ok: false as const, error: "UNAUTHORIZED" as const };

  return { ok: true as const, mode: "header" as const };
}

// Claim one job safely (SKIP LOCKED so concurrent crons don’t double-run)
async function claimJob(max: number) {
  const r = await db.execute(sql`
    with picked as (
      select id
      from render_jobs
      where status = 'queued'
      order by created_at asc
      limit ${max}
      for update skip locked
    )
    update render_jobs j
    set status = 'running', started_at = now()
    from picked
    where j.id = picked.id
    returning j.id, j.tenant_id, j.quote_log_id, j.prompt, j.created_at
  `);

  const rows: any[] = (r as any)?.rows ?? (Array.isArray(r) ? (r as any) : []);
  return rows.map((x) => ({
    id: String(x.id),
    tenantId: String(x.tenant_id),
    quoteLogId: String(x.quote_log_id),
    prompt: String(x.prompt ?? ""),
    createdAt: x.created_at,
  }));
}

async function markJobDone(jobId: string, status: "done" | "failed", error?: string | null) {
  await db.execute(sql`
    update render_jobs
    set status = ${status}, finished_at = now(), error = ${error ?? null}
    where id = ${jobId}::uuid
  `);
}

// Reads everything the worker needs in one shot
async function loadRenderContext(tenantId: string, quoteLogId: string) {
  const r = await db.execute(sql`
    select
      t.id as tenant_id,
      t.slug as tenant_slug,
      t.name as tenant_name,

      ts.business_name,
      ts.brand_logo_url,
      ts.lead_to_email,
      ts.rendering_enabled,
      ts.rendering_style,
      ts.rendering_notes,

      sec.openai_key_enc,

      q.id as quote_log_id,
      q.input,
      q.output,
      q.render_opt_in
    from tenants t
    left join tenant_settings ts on ts.tenant_id = t.id
    left join tenant_secrets sec on sec.tenant_id = t.id
    left join quote_logs q on q.id = ${quoteLogId}::uuid
    where t.id = ${tenantId}::uuid
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  return row ?? null;
}

async function updateQuoteRendered(args: {
  tenantId: string;
  quoteLogId: string;
  imageUrl: string;
  prompt: string;
}) {
  await db.execute(sql`
    update quote_logs
    set
      render_status = 'rendered',
      render_image_url = ${args.imageUrl},
      render_prompt = ${args.prompt},
      render_error = null,
      rendered_at = now()
    where id = ${args.quoteLogId}::uuid
      and tenant_id = ${args.tenantId}::uuid
  `);
}

async function updateQuoteFailed(args: {
  tenantId: string;
  quoteLogId: string;
  prompt: string;
  error: string;
}) {
  await db.execute(sql`
    update quote_logs
    set
      render_status = 'failed',
      render_prompt = ${args.prompt},
      render_error = ${args.error}
    where id = ${args.quoteLogId}::uuid
      and tenant_id = ${args.tenantId}::uuid
  `);
}

export async function POST(req: Request) {
  const debugId = crypto.randomBytes(6).toString("hex");
  const startedAt = Date.now();

  const auth = await requireCronSecret(req);
  if (!auth.ok) return json({ ok: false, error: "UNAUTHORIZED" }, 401, debugId);

  const url = new URL(req.url);
  const max = Math.max(1, Math.min(10, Number(url.searchParams.get("max") ?? "1") || 1));

  // Claim jobs
  const claimed = await claimJob(max);
  if (!claimed.length) {
    return json(
      { ok: true, authMode: auth.mode, claimed: 0, processed: [], durationMs: Date.now() - startedAt },
      200,
      debugId
    );
  }

  const processed: any[] = [];

  for (const job of claimed) {
    const jobDebugId = `${debugId}_${job.id.slice(0, 6)}`;

    try {
      // Load tenant + quote context
      const ctx = await loadRenderContext(job.tenantId, job.quoteLogId);
      if (!ctx) throw new Error("Missing tenant/quote context for job.");

      const tenantSlug = String(ctx.tenant_slug ?? "");
      const tenantName = String(ctx.tenant_name ?? "Your Business");

      const renderingEnabled = ctx.rendering_enabled;
      if (renderingEnabled === false) {
        await updateQuoteFailed({
          tenantId: job.tenantId,
          quoteLogId: job.quoteLogId,
          prompt: job.prompt,
          error: "Rendering disabled by tenant settings.",
        });
        await markJobDone(job.id, "failed", "Tenant disabled rendering.");
        processed.push({ jobId: job.id, quoteLogId: job.quoteLogId, ok: false, error: "TENANT_RENDERING_DISABLED" });
        continue;
      }

      const inputAny: any = safeJsonParse(ctx.input) ?? {};
      const outputAny: any = safeJsonParse(ctx.output) ?? {};

      const optIn = Boolean(ctx.render_opt_in) || Boolean(inputAny?.render_opt_in) || Boolean(inputAny?.customer_context?.render_opt_in);
      if (!optIn) {
        await markJobDone(job.id, "done", null);
        processed.push({ jobId: job.id, quoteLogId: job.quoteLogId, ok: true, skipped: true, reason: "not_opted_in" });
        continue;
      }

      const images = Array.isArray(inputAny?.images) ? inputAny.images : [];
      if (!images.length) {
        await updateQuoteFailed({
          tenantId: job.tenantId,
          quoteLogId: job.quoteLogId,
          prompt: job.prompt,
          error: "No images stored on quote.",
        });
        await markJobDone(job.id, "failed", "No images.");
        processed.push({ jobId: job.id, quoteLogId: job.quoteLogId, ok: false, error: "NO_IMAGES" });
        continue;
      }

      // OpenAI key
      const enc = ctx.openai_key_enc;
      if (!enc) throw new Error("Missing tenant OpenAI key (tenant_secrets.openai_key_enc).");
      const apiKey = decryptSecret(String(enc));
      if (!apiKey) throw new Error("Unable to decrypt tenant OpenAI key.");

      // Build prompt/model from PCC (single source of truth)
      const pcc = await loadPlatformLlmConfig();
      const renderModel = safeTrim(pcc?.models?.renderModel) || "gpt-image-1";

      const tenantStyleKey = safeTrim(ctx.rendering_style) || "photoreal";
      const tenantRenderNotes = safeTrim(ctx.rendering_notes) || "";

      const presets = (pcc?.prompts?.renderStylePresets ?? {}) as any;
      const presetText =
        tenantStyleKey === "clean_oem"
          ? safeTrim(presets.clean_oem)
          : tenantStyleKey === "custom"
            ? safeTrim(presets.custom)
            : safeTrim(presets.photoreal);

      const styleText =
        presetText || "photorealistic, natural colors, clean lighting, product photography look, high detail";

      const renderPromptPreamble = safeTrim(pcc?.prompts?.renderPromptPreamble) || "";

      const summary = typeof outputAny?.summary === "string" ? outputAny.summary : "";
      const serviceType = inputAny?.customer_context?.service_type || inputAny?.customer_context?.category || "";
      const customerNotes = String(inputAny?.customer_context?.notes ?? "").trim();

      const renderPromptTemplate =
        safeTrim(pcc?.prompts?.renderPromptTemplate) ||
        [
          "{renderPromptPreamble}",
          "Generate a realistic 'after' concept rendering based on the customer's photos.",
          "Do NOT add text or watermarks.",
          "Style: {style}",
          "{serviceTypeLine}",
          "{summaryLine}",
          "{customerNotesLine}",
          "{tenantRenderNotesLine}",
        ].join("\n");

      const prompt = renderPromptTemplate
        .split("{renderPromptPreamble}").join(renderPromptPreamble)
        .split("{style}").join(styleText)
        .split("{serviceTypeLine}").join(serviceType ? `Service type: ${serviceType}` : "")
        .split("{summaryLine}").join(summary ? `Estimate summary context: ${summary}` : "")
        .split("{customerNotesLine}").join(customerNotes ? `Customer notes: ${customerNotes}` : "")
        .split("{tenantRenderNotesLine}").join(tenantRenderNotes ? `Tenant render notes: ${tenantRenderNotes}` : "")
        .split("\n")
        .map((l) => l.trimEnd())
        .filter((line, idx, arr) => !(line.trim() === "" && (arr[idx - 1]?.trim() === "")))
        .join("\n")
        .trim();

      // Debug payload (stored ONLY in output.render_debug)
      const debugEnabled = isRenderDebugEnabled();
      if (debugEnabled) {
        const renderDebug = buildRenderDebugPayload({
          debugId: jobDebugId,
          renderModel,
          tenantStyleKey,
          styleText,
          renderPromptPreamble,
          renderPromptTemplate,
          finalPrompt: prompt,
          serviceType,
          summary,
          customerNotes,
          tenantRenderNotes,
          images,
        });

        const renderDebug = {
  ...buildRenderDebugPayload({
    debugId,
    renderModel,
    tenantStyleKey,
    styleText,
    renderPromptPreamble,
    renderPromptTemplate,
    finalPrompt: prompt,
    serviceType,
    summary,
    customerNotes,
    tenantRenderNotes,
    images,
  }),
  env: {
    PCC_RENDER_DEBUG: String(process.env.PCC_RENDER_DEBUG ?? "").trim() || null,
    VERCEL_ENV: String(process.env.VERCEL_ENV ?? "").trim() || null,
    VERCEL_GIT_COMMIT_SHA: String(process.env.VERCEL_GIT_COMMIT_SHA ?? "").trim() || null,
  },
};

        try {
          await setRenderDebug({ db: db as any, quoteLogId: job.quoteLogId, tenantId: job.tenantId, debug: renderDebug });
        } catch {
          // debug should never break rendering
        }
      }

      // Generate image
      const openai = new OpenAI({ apiKey });
      const imgResp: any = await openai.images.generate({
        model: renderModel,
        prompt,
        size: "1024x1024",
      });

      const b64: string | undefined = imgResp?.data?.[0]?.b64_json;
      if (!b64) throw new Error("Image generation returned no b64_json.");

      const bytes = Buffer.from(b64, "base64");

      // Upload to blob
      const key = `renders/${tenantSlug}/${job.quoteLogId}-${Date.now()}.png`;
      const blob = await put(key, bytes, { access: "public", contentType: "image/png" });
      const imageUrl = blob?.url;
      if (!imageUrl) throw new Error("Blob upload returned no url.");

      // Update quote log
      await updateQuoteRendered({ tenantId: job.tenantId, quoteLogId: job.quoteLogId, imageUrl, prompt });

      // Emails (enterprise/standard stays intact via sendEmail + getTenantEmailConfig)
      try {
        const cfg = await getTenantEmailConfig(job.tenantId);

        const businessName = (cfg.businessName || ctx.business_name || tenantName || "Your Business").trim();
        const brandLogoUrl = ctx.brand_logo_url ?? null;

        const customer = inputAny?.customer ?? inputAny?.contact ?? null;
        const customerName = String(customer?.name ?? "Customer").trim();
        const customerEmail = String(customer?.email ?? "").trim().toLowerCase();
        const customerPhone = String(customer?.phone ?? "").trim();

        const estimateLow = typeof outputAny?.estimate_low === "number" ? outputAny.estimate_low : null;
        const estimateHigh = typeof outputAny?.estimate_high === "number" ? outputAny.estimate_high : null;

        const baseUrl = getBaseUrl(req);
        const publicQuoteUrl = baseUrl ? `${baseUrl}/q/${encodeURIComponent(tenantSlug)}` : null;
        const adminQuoteUrl = baseUrl ? `${baseUrl}/admin/quotes/${encodeURIComponent(job.quoteLogId)}` : null;

        const renderEmailResult: any = {
          lead_render: { attempted: false, ok: false, id: null as string | null, error: null as string | null },
          customer_render: { attempted: false, ok: false, id: null as string | null, error: null as string | null },
        };

        if (cfg.fromEmail && cfg.leadToEmail) {
          try {
            renderEmailResult.lead_render.attempted = true;

            const htmlLead = renderLeadRenderCompleteEmailHTML({
              businessName,
              brandLogoUrl,
              quoteLogId: job.quoteLogId,
              tenantSlug,
              customerName,
              customerEmail,
              customerPhone,
              renderImageUrl: imageUrl,
              estimateLow,
              estimateHigh,
              summary,
              adminQuoteUrl,
            });

            const r1 = await sendEmail({
              tenantId: job.tenantId,
              context: { type: "lead_render_complete", quoteLogId: job.quoteLogId },
              message: {
                from: cfg.fromEmail,
                to: [cfg.leadToEmail],
                replyTo: [cfg.leadToEmail],
                subject: `Render complete — ${customerName}`,
                html: htmlLead,
              },
            });

            renderEmailResult.lead_render.ok = r1.ok;
            renderEmailResult.lead_render.id = r1.providerMessageId ?? null;
            renderEmailResult.lead_render.error = r1.error ?? null;
          } catch (e: any) {
            renderEmailResult.lead_render.error = e?.message ?? String(e);
          }
        }

        if (cfg.fromEmail && customerEmail) {
          try {
            renderEmailResult.customer_render.attempted = true;

            const htmlCust = renderCustomerRenderCompleteEmailHTML({
              businessName,
              brandLogoUrl,
              customerName,
              quoteLogId: job.quoteLogId,
              renderImageUrl: imageUrl,
              estimateLow,
              estimateHigh,
              summary,
              publicQuoteUrl,
              replyToEmail: cfg.leadToEmail ?? null,
            });

            const r2 = await sendEmail({
              tenantId: job.tenantId,
              context: { type: "customer_render_complete", quoteLogId: job.quoteLogId },
              message: {
                from: cfg.fromEmail,
                to: [customerEmail],
                replyTo: cfg.leadToEmail ? [cfg.leadToEmail] : undefined,
                subject: `Your concept render is ready — ${businessName}`,
                html: htmlCust,
              },
            });

            renderEmailResult.customer_render.ok = r2.ok;
            renderEmailResult.customer_render.id = r2.providerMessageId ?? null;
            renderEmailResult.customer_render.error = r2.error ?? null;
          } catch (e: any) {
            renderEmailResult.customer_render.error = e?.message ?? String(e);
          }
        }

        try {
          await setRenderEmailResult({
            db: db as any,
            quoteLogId: job.quoteLogId,
            tenantId: job.tenantId,
            emailResult: renderEmailResult,
          });
        } catch {
          // ignore
        }
      } catch {
        // ignore email failures (render is still a success)
      }

      await markJobDone(job.id, "done", null);
      processed.push({ jobId: job.id, quoteLogId: job.quoteLogId, ok: true, imageUrl });
    } catch (e: any) {
      const msg = safeErr(e);

      try {
        await updateQuoteFailed({
          tenantId: job.tenantId,
          quoteLogId: job.quoteLogId,
          prompt: job.prompt,
          error: msg,
        });
      } catch {
        // ignore
      }

      await markJobDone(job.id, "failed", msg);
      processed.push({ jobId: job.id, quoteLogId: job.quoteLogId, ok: false, error: msg });
    }
  }

  return json(
    {
      ok: true,
      authMode: auth.mode,
      claimed: claimed.length,
      processed,
      durationMs: Date.now() - startedAt,
    },
    200,
    debugId
  );
}