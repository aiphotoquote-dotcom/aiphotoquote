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
import { resolveTenantLlm } from "@/lib/pcc/llm/resolveTenant";

import { isRenderDebugEnabled, buildRenderDebugPayload } from "@/lib/pcc/render/debug";
import { setRenderDebug, setRenderEmailResult } from "@/lib/pcc/render/output";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ✅ critical: image generation + blob upload + emails can exceed default serverless time
export const maxDuration = 300;

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

/**
 * Prefer actual host over VERCEL_URL.
 */
function getBaseUrl(req: Request) {
  const envBase = safeTrim(process.env.NEXT_PUBLIC_APP_URL) || safeTrim(process.env.APP_URL);
  if (envBase) return envBase.replace(/\/+$/, "");

  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`.replace(/\/+$/, "");

  const vercel = safeTrim(process.env.VERCEL_URL);
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;

  return "";
}

// ---- AUTH DIAGNOSTICS (safe) ----
function shaPrefix(v: string) {
  if (!v) return null;
  return crypto.createHash("sha256").update(v).digest("hex").slice(0, 10);
}

function getCronSecretFromQuery(req: Request) {
  try {
    const url = new URL(req.url);
    const v = safeTrim(url.searchParams.get("cron_secret"));
    return v || "";
  } catch {
    return "";
  }
}

function getTokenFromAuthHeader(req: Request) {
  const authRaw = safeTrim(req.headers.get("authorization"));
  if (!authRaw) return "";
  const lower = authRaw.toLowerCase();
  if (lower.startsWith("bearer ")) return authRaw.slice(7).trim();
  return authRaw.trim();
}

function buildAuthDebug(req: Request) {
  const configuredRaw = safeTrim(process.env.CRON_SECRET);
  const headerToken = getTokenFromAuthHeader(req);
  const queryToken = getCronSecretFromQuery(req);

  const hasConfigured = Boolean(configuredRaw);
  const hasHeader = Boolean(headerToken);
  const hasQuery = Boolean(queryToken);

  const matchesHeader = hasConfigured ? headerToken === configuredRaw : true;
  const matchesQuery = hasConfigured ? queryToken === configuredRaw : true;

  return {
    configured: hasConfigured,
    header: {
      present: hasHeader,
      looksBearer: safeTrim(req.headers.get("authorization")).toLowerCase().startsWith("bearer "),
      receivedTokenSha10: hasHeader ? shaPrefix(headerToken) : null,
      matches: matchesHeader,
    },
    query: {
      present: hasQuery,
      receivedTokenSha10: hasQuery ? shaPrefix(queryToken) : null,
      matches: matchesQuery,
      paramName: "cron_secret",
    },
    configuredSha10: hasConfigured ? shaPrefix(configuredRaw) : null,
    env: {
      VERCEL_ENV: safeTrim(process.env.VERCEL_ENV) || null,
      VERCEL_URL: safeTrim(process.env.VERCEL_URL) || null,
      NEXT_PUBLIC_APP_URL: safeTrim(process.env.NEXT_PUBLIC_APP_URL) || null,
      APP_URL: safeTrim(process.env.APP_URL) || null,
    },
    request: {
      url: req.url,
      method: (req as any)?.method ?? null,
      host: safeTrim(req.headers.get("host")) || null,
      xForwardedHost: safeTrim(req.headers.get("x-forwarded-host")) || null,
      xForwardedProto: safeTrim(req.headers.get("x-forwarded-proto")) || null,
    },
  };
}

/**
 * CRON protection.
 */
async function requireCronSecret(req: Request) {
  const configured = safeTrim(process.env.CRON_SECRET);
  if (!configured) return { ok: true as const, mode: "no_secret_configured" as const };

  const headerToken = getTokenFromAuthHeader(req);
  const queryToken = getCronSecretFromQuery(req);

  if (headerToken && headerToken === configured) return { ok: true as const, mode: "header" as const };
  if (queryToken && queryToken === configured) return { ok: true as const, mode: "query" as const };

  return { ok: false as const, error: "UNAUTHORIZED" as const };
}

/**
 * Claim jobs safely.
 * ✅ Also re-claim stale running jobs (prevents “stuck at 92% forever”):
 * - if status='running' and started_at older than 10 minutes => treat as stale and retry
 */
async function claimJob(max: number) {
  const r = await db.execute(sql`
    with picked as (
      select id
      from render_jobs
      where
        status = 'queued'
        or (status = 'running' and started_at is not null and started_at < (now() - interval '10 minutes'))
      order by created_at asc
      limit ${max}
      for update skip locked
    )
    update render_jobs j
    set
      status = 'running',
      started_at = now()
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
      ts.brand_logo_variant,
      ts.lead_to_email,

      ts.plan_tier,

      ts.rendering_enabled,
      ts.ai_rendering_enabled,

      ts.rendering_style,
      ts.rendering_notes,

      -- ✅ NEW: keep cron render on-industry
      ts.industry_key,

      -- ✅ NEW: rate limit semantics live here (0 = unlimited)
      ts.rendering_max_per_day,

      sec.openai_key_enc,

      q.id as quote_log_id,
      q.input,
      q.output,
      q.render_opt_in,
      q.render_status,
      q.render_image_url,
      q.render_error
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

async function markQuoteRunning(args: { tenantId: string; quoteLogId: string }) {
  await db.execute(sql`
    update quote_logs
    set
      render_status = 'running',
      render_error = null
    where id = ${args.quoteLogId}::uuid
      and tenant_id = ${args.tenantId}::uuid
  `);
}

async function updateQuoteRendered(args: { tenantId: string; quoteLogId: string; imageUrl: string; prompt: string }) {
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

async function updateQuoteFailed(args: { tenantId: string; quoteLogId: string; prompt: string; error: string }) {
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

function coalesceTenantRenderEnabled(ctx: any, resolvedTenantRenderEnabled: boolean) {
  if (typeof resolvedTenantRenderEnabled === "boolean") return resolvedTenantRenderEnabled;

  const ai = ctx?.ai_rendering_enabled;
  if (typeof ai === "boolean") return ai;

  const legacy = ctx?.rendering_enabled;
  if (typeof legacy === "boolean") return legacy;

  return false;
}

/**
 * Tier0 must never render.
 */
function isPlanAllowedToRender(planTierRaw: unknown) {
  const plan = safeTrim(planTierRaw).toLowerCase();
  if (!plan) return true;
  if (plan === "tier0") return false;
  return true;
}

/**
 * ✅ Rate limit semantics:
 * - maxPerDay <= 0 => unlimited (rate limit OFF)
 * - maxPerDay > 0  => enforce
 */
function normalizeMaxPerDay(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

async function isRateLimitedNow(args: { tenantId: string; maxPerDay: number }) {
  const { tenantId, maxPerDay } = args;

  if (maxPerDay <= 0) {
    return { limited: false as const, maxPerDay };
  }

  // Count renders today (UTC), per-tenant
  const r = await db.execute(sql`
    select count(*)::int as n
    from quote_logs
    where tenant_id = ${tenantId}::uuid
      and render_status = 'rendered'
      and rendered_at is not null
      and rendered_at >= date_trunc('day', now())
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  const n = Number(row?.n ?? 0);

  return { limited: n >= maxPerDay, maxPerDay, usedToday: Number.isFinite(n) ? n : 0 };
}

function collapseBlankLines(s: string) {
  return s
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((line, idx, arr) => !(line.trim() === "" && (arr[idx - 1]?.trim() === "")))
    .join("\n")
    .trim();
}

async function handleCron(req: Request) {
  const debugId = crypto.randomBytes(6).toString("hex");
  const startedAt = Date.now();

  const url = new URL(req.url);
  const wantDebug = url.searchParams.get("debug") === "1";

  const auth = await requireCronSecret(req);
  if (!auth.ok) {
    return json(
      { ok: false, error: "UNAUTHORIZED", ...(wantDebug ? { debug: { auth: buildAuthDebug(req) } } : {}) },
      401,
      debugId
    );
  }

  const max = Math.max(1, Math.min(10, Number(url.searchParams.get("max") ?? "1") || 1));

  const claimed = await claimJob(max);
  if (!claimed.length) {
    return json(
      {
        ok: true,
        authMode: auth.mode,
        claimed: 0,
        processed: [],
        durationMs: Date.now() - startedAt,
        ...(wantDebug ? { debug: { auth: buildAuthDebug(req) } } : {}),
      },
      200,
      debugId
    );
  }

  const processed: any[] = [];
  const debugEnabled = isRenderDebugEnabled();

  // PCC prompt assets (templates/presets/packs) are platform-level
  const pcc = await loadPlatformLlmConfig();

  for (const job of claimed) {
    const jobDebugId = `${debugId}_${job.id.slice(0, 6)}`;

    try {
      // make quote show “running” immediately
      try {
        await markQuoteRunning({ tenantId: job.tenantId, quoteLogId: job.quoteLogId });
      } catch {
        // ignore
      }

      const ctx = await loadRenderContext(job.tenantId, job.quoteLogId);
      if (!ctx) throw new Error("Missing tenant/quote context for job.");

      const tenantSlug = String(ctx.tenant_slug ?? "");
      const tenantName = String(ctx.tenant_name ?? "Your Business");

      if (!isPlanAllowedToRender(ctx.plan_tier)) {
        const plan = safeTrim(ctx.plan_tier) || "unknown";
        const msg = `Rendering is not available on plan tier: ${plan}.`;

        await updateQuoteFailed({ tenantId: job.tenantId, quoteLogId: job.quoteLogId, prompt: job.prompt, error: msg });
        await markJobDone(job.id, "failed", msg);
        processed.push({
          jobId: job.id,
          quoteLogId: job.quoteLogId,
          ok: false,
          error: "PLAN_RENDERING_DISABLED",
          planTier: plan,
        });
        continue;
      }

      // ✅ Resolve tenant + PCC AI settings (authoritative)
      const resolved = await resolveTenantLlm(job.tenantId);
      const renderModel = safeTrim(resolved.models.renderModel) || "gpt-image-1";

      const tenantRenderEnabled = coalesceTenantRenderEnabled(ctx, resolved.tenant.tenantRenderEnabled);
      if (tenantRenderEnabled === false) {
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

      // ✅ Rate limit enforcement (0 = unlimited)
      const maxPerDay = normalizeMaxPerDay(ctx.rendering_max_per_day);
      const rate = await isRateLimitedNow({ tenantId: job.tenantId, maxPerDay });

      if (rate.limited) {
        const msg = `Renderings are disabled by rate limit (max per day = ${rate.maxPerDay}).`;

        await updateQuoteFailed({
          tenantId: job.tenantId,
          quoteLogId: job.quoteLogId,
          prompt: job.prompt,
          error: msg,
        });

        await markJobDone(job.id, "failed", msg);
        processed.push({
          jobId: job.id,
          quoteLogId: job.quoteLogId,
          ok: false,
          error: "RATE_LIMITED",
          maxPerDay: rate.maxPerDay,
          usedToday: (rate as any).usedToday ?? null,
        });
        continue;
      }

      const inputAny: any = safeJsonParse(ctx.input) ?? {};
      const outputAny: any = safeJsonParse(ctx.output) ?? {};

      const optIn =
        Boolean(ctx.render_opt_in) ||
        Boolean(inputAny?.render_opt_in) ||
        Boolean(inputAny?.customer_context?.render_opt_in);

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

      // OpenAI key (tenant-only render right now)
      const enc = ctx.openai_key_enc;
      if (!enc) throw new Error("Missing tenant OpenAI key (tenant_secrets.openai_key_enc).");
      const apiKey = decryptSecret(String(enc));
      if (!apiKey) throw new Error("Unable to decrypt tenant OpenAI key.");

      // ✅ Industry key (keep render on-topic)
      const industryKey = safeTrim(ctx.industry_key).toLowerCase() || safeTrim(resolved?.meta?.industryKey).toLowerCase() || "";

      // ✅ Pull industry render guidance from PCC packs (platform-owned)
      const pack: any = industryKey ? (pcc as any)?.prompts?.industryPromptPacks?.[industryKey] : null;

      const industryAddendum =
        safeTrim(pack?.renderPromptAddendum) ||
        ""; // optional

      const industryNegative =
        safeTrim(pack?.renderNegativeGuidance) ||
        ""; // optional

      // ✅ Tenant style/notes: prefer tenant_settings columns, fallback to resolver
      const tenantStyleKey = safeTrim(ctx.rendering_style) || safeTrim(resolved.tenant.tenantStyleKey) || "photoreal";
      const tenantRenderNotes = safeTrim(ctx.rendering_notes) || safeTrim(resolved.tenant.tenantRenderNotes) || "";

      // Build prompt from PCC (platform-level prompt assets)
      const presets = ((pcc as any)?.prompts?.renderStylePresets ?? {}) as any;
      const presetText =
        tenantStyleKey === "clean_oem"
          ? safeTrim(presets.clean_oem)
          : tenantStyleKey === "custom"
          ? safeTrim(presets.custom)
          : safeTrim(presets.photoreal);

      const styleText =
        presetText || "photorealistic, natural colors, clean lighting, product photography look, high detail";

      const basePreamble = safeTrim((pcc as any)?.prompts?.renderPromptPreamble) || "";
      const renderPromptPreamble = collapseBlankLines(
        [basePreamble, industryKey ? `Industry key: ${industryKey}` : "", industryAddendum].filter(Boolean).join("\n")
      );

      const summary = typeof outputAny?.summary === "string" ? outputAny.summary : "";
      const serviceType = inputAny?.customer_context?.service_type || inputAny?.customer_context?.category || "";
      const customerNotes = String(inputAny?.customer_context?.notes ?? "").trim();

      const renderPromptTemplate =
        safeTrim((pcc as any)?.prompts?.renderPromptTemplate) ||
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

      // We inject negative guidance as a “tenant notes line” add-on so we don’t need new placeholders.
      const notesPlusNegative = collapseBlankLines(
        [tenantRenderNotes ? `Tenant render notes: ${tenantRenderNotes}` : "", industryNegative ? `Avoid: ${industryNegative}` : ""]
          .filter(Boolean)
          .join("\n")
      );

      const prompt = collapseBlankLines(
        renderPromptTemplate
          .split("{renderPromptPreamble}")
          .join(renderPromptPreamble)
          .split("{style}")
          .join(styleText)
          .split("{serviceTypeLine}")
          .join(serviceType ? `Service type: ${serviceType}` : industryKey ? `Service type: ${industryKey}` : "")
          .split("{summaryLine}")
          .join(summary ? `Estimate summary context: ${summary}` : "")
          .split("{customerNotesLine}")
          .join(customerNotes ? `Customer notes: ${customerNotes}` : "")
          .split("{tenantRenderNotesLine}")
          .join(notesPlusNegative ? notesPlusNegative : "")
      );

      if (debugEnabled) {
        const renderDebug: any = {
          ...buildRenderDebugPayload({
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
          }),
          industry: {
            industryKey: industryKey || null,
            hasIndustryPack: Boolean(pack),
            renderPromptAddendumLen: industryAddendum ? industryAddendum.length : 0,
            renderNegativeGuidanceLen: industryNegative ? industryNegative.length : 0,
          },
          rateLimit: {
            maxPerDay,
            // usedToday only exists when maxPerDay > 0
            usedToday: (rate as any).usedToday ?? null,
            enabled: maxPerDay > 0,
          },
          env: {
            PCC_RENDER_DEBUG: String(process.env.PCC_RENDER_DEBUG ?? "").trim() || null,
            VERCEL_ENV: String(process.env.VERCEL_ENV ?? "").trim() || null,
            VERCEL_GIT_COMMIT_SHA: String(process.env.VERCEL_GIT_COMMIT_SHA ?? "").trim() || null,
          },
        };

        try {
          await setRenderDebug({ db: db as any, quoteLogId: job.quoteLogId, tenantId: job.tenantId, debug: renderDebug });
        } catch {
          // ignore
        }
      }

      // ✅ OpenAI image generation (fail fast; don’t hang the cron forever)
      const openai = new OpenAI({
        apiKey,
        // supported by openai node client; keeps cron from hanging indefinitely
        timeout: 90_000,
        maxRetries: 1,
      } as any);

      const imgResp: any = await openai.images.generate({
        model: renderModel,
        prompt,
        size: "1024x1024",
      });

      const b64: string | undefined = imgResp?.data?.[0]?.b64_json;
      if (!b64) throw new Error("Image generation returned no b64_json.");

      const bytes = Buffer.from(b64, "base64");

      const key = `renders/${tenantSlug}/${job.quoteLogId}-${Date.now()}.png`;
      const blob = await put(key, bytes, { access: "public", contentType: "image/png" });
      const imageUrl = blob?.url;
      if (!imageUrl) throw new Error("Blob upload returned no url.");

      await updateQuoteRendered({ tenantId: job.tenantId, quoteLogId: job.quoteLogId, imageUrl, prompt });

      // Emails (best-effort)
      try {
        const cfg = await getTenantEmailConfig(job.tenantId);
        const businessName = (cfg.businessName || ctx.business_name || tenantName || "Your Business").trim();
        const brandLogoUrl = ctx.brand_logo_url ?? null;

        const brandLogoVariantRaw = String((ctx as any)?.brand_logo_variant ?? "").trim().toLowerCase();
        const brandLogoVariant =
          brandLogoVariantRaw === "light" ? "light" : brandLogoVariantRaw === "dark" ? "dark" : null;

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
              brandLogoVariant,
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
              brandLogoVariant,
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
        // ignore
      }

      await markJobDone(job.id, "done", null);
      processed.push({ jobId: job.id, quoteLogId: job.quoteLogId, ok: true, imageUrl, renderModel, industryKey: industryKey || null });
    } catch (e: any) {
      const msg = safeErr(e);

      try {
        await updateQuoteFailed({ tenantId: job.tenantId, quoteLogId: job.quoteLogId, prompt: job.prompt, error: msg });
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
      ...(wantDebug ? { debug: { auth: buildAuthDebug(req) } } : {}),
    },
    200,
    debugId
  );
}

export async function GET(req: Request) {
  return handleCron(req);
}

export async function POST(req: Request) {
  return handleCron(req);
}