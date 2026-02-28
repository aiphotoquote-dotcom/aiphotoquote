// src/app/api/cron/render/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import crypto from "crypto";
import OpenAI, { toFile } from "openai";
import { put } from "@vercel/blob";

import { db } from "@/lib/db/client";
import { decryptSecret } from "@/lib/crypto";

import { sendEmail } from "@/lib/email";
import { getTenantEmailConfig } from "@/lib/email/tenantEmail";
import { renderCustomerRenderCompleteEmailHTML } from "@/lib/email/templates/renderCompleteCustomer";
import { renderLeadRenderCompleteEmailHTML } from "@/lib/email/templates/renderCompleteLead";

import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";
import { resolveTenantLlm } from "@/lib/pcc/llm/resolveTenant";
import { getIndustryLlmPackWithMeta } from "@/lib/pcc/llm/industryStore";

import { isRenderDebugEnabled, buildRenderDebugPayload } from "@/lib/pcc/render/debug";
import { setRenderDebug, setRenderEmailResult } from "@/lib/pcc/render/output";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ✅ image generation + blob upload + emails can exceed default serverless time
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
 * Claim jobs safely from quote_renders.
 * ✅ Also re-claim stale running jobs (prevents “stuck forever”):
 * - if status='running' and started_at older than 10 minutes => treat as stale and retry
 */
async function claimJobs(max: number) {
  const r = await db.execute(sql`
    with picked as (
      select id
      from quote_renders
      where
        status = 'queued'
        or (status = 'running' and started_at is not null and started_at < (now() - interval '10 minutes'))
      order by created_at asc
      limit ${max}
      for update skip locked
    )
    update quote_renders r
    set
      status = 'running',
      started_at = now()
    from picked
    where r.id = picked.id
    returning
      r.id,
      r.tenant_id,
      r.quote_log_id,
      r.quote_version_id,
      r.attempt,
      r.prompt,
      r.shop_notes,
      r.created_at
  `);

  const rows: any[] = (r as any)?.rows ?? (Array.isArray(r) ? (r as any) : []);
  return rows.map((x) => ({
    id: String(x.id),
    tenantId: String(x.tenant_id),
    quoteLogId: String(x.quote_log_id),
    quoteVersionId: String(x.quote_version_id),
    attempt: Number(x.attempt ?? 1),
    prompt: String(x.prompt ?? ""),
    shopNotes: String(x.shop_notes ?? ""),
    createdAt: x.created_at,
  }));
}

async function markRenderRowDone(args: {
  renderId: string;
  status: "rendered" | "failed";
  imageUrl?: string | null;
  prompt?: string | null;
  error?: string | null;
}) {
  await db.execute(sql`
    update quote_renders
    set
      status = ${args.status},
      image_url = ${args.imageUrl ?? null},
      prompt = ${args.prompt ?? null},
      error = ${args.error ?? null},
      completed_at = now()
    where id = ${args.renderId}::uuid
  `);
}

async function selectThisAttempt(args: { tenantId: string; quoteVersionId: string; renderId: string }) {
  // ensure exactly one selected render per version
  await db.execute(sql`
    update quote_renders
    set is_selected = false
    where tenant_id = ${args.tenantId}::uuid
      and quote_version_id = ${args.quoteVersionId}::uuid
  `);

  await db.execute(sql`
    update quote_renders
    set is_selected = true
    where id = ${args.renderId}::uuid
      and tenant_id = ${args.tenantId}::uuid
      and quote_version_id = ${args.quoteVersionId}::uuid
  `);
}

// Reads everything the worker needs in one shot (tenant + quote_log + quote_version)
async function loadRenderContext(args: { tenantId: string; quoteLogId: string; quoteVersionId: string }) {
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
      ts.activation_grace_credits,
      ts.activation_grace_used,

      ts.rendering_enabled,
      ts.ai_rendering_enabled,

      ts.rendering_style,
      ts.rendering_notes,

      -- ✅ Tenant rendering layers (new)
      ts.rendering_prompt_addendum,
      ts.rendering_negative_guidance,

      -- ✅ keep cron render on-industry
      ts.industry_key,

      -- ✅ rate limit semantics live here (0 = unlimited)
      ts.rendering_max_per_day,

      sec.openai_key_enc,

      q.id as quote_log_id,
      q.input as quote_input,
      q.output as quote_output,
      q.render_opt_in,
      q.render_status,
      q.render_image_url,
      q.render_error,

      v.id as quote_version_id,
      v.version as quote_version_num,
      v.output as version_output,
      v.ai_mode as version_ai_mode

    from tenants t
    left join tenant_settings ts on ts.tenant_id = t.id
    left join tenant_secrets sec on sec.tenant_id = t.id
    left join quote_logs q on q.id = ${args.quoteLogId}::uuid
    left join quote_versions v on v.id = ${args.quoteVersionId}::uuid

    where t.id = ${args.tenantId}::uuid
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
 * ✅ Plan policy for renders
 * - If tenant has its own key => allow on any tier
 * - If tenant does NOT have a key:
 *    - allow ONLY when plan tier is tier0/tier1/tier2 AND grace credits remain AND platform key exists
 */
function graceRemaining(planTierRaw: unknown, graceTotalRaw: unknown, graceUsedRaw: unknown) {
  const plan = safeTrim(planTierRaw).toLowerCase();
  const total = Number(graceTotalRaw ?? 0);
  const used = Number(graceUsedRaw ?? 0);
  const t = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  const u = Number.isFinite(used) ? Math.max(0, Math.trunc(used)) : 0;

  const eligibleTier = plan === "tier0" || plan === "tier1" || plan === "tier2";
  if (!eligibleTier) return { plan, eligibleTier, remaining: null as number | null, inGrace: false };

  const remaining = Math.max(0, t - u);
  return { plan, eligibleTier, remaining, inGrace: remaining > 0 };
}

async function bumpGraceUsedIfGraceTier(tenantId: string) {
  try {
    await db.execute(sql`
      update tenant_settings
      set activation_grace_used = coalesce(activation_grace_used, 0) + 1,
          updated_at = now()
      where tenant_id = ${tenantId}::uuid
        and lower(coalesce(plan_tier,'')) in ('tier0','tier1','tier2')
    `);
  } catch {
    // ignore
  }
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

  // Count renders today (UTC), per-tenant (legacy field = rendered_at on quote_logs)
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

function pickFirstImageUrl(images: any[]): string {
  if (!Array.isArray(images)) return "";
  const primary = images.find((x) => x && ((x as any).is_primary === true || (x as any).isPrimary === true));
  const cands = [primary, images[0]].filter(Boolean);

  for (const it of cands) {
    const url = safeTrim((it as any)?.url || (it as any)?.publicUrl || (it as any)?.blobUrl);
    if (url) return url;
  }

  for (const it of images) {
    const url = safeTrim((it as any)?.url || (it as any)?.publicUrl || (it as any)?.blobUrl);
    if (url) return url;
  }

  return "";
}

async function fetchImageAsFile(url: string) {
  const u = safeTrim(url);
  if (!u) return null;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(u, { cache: "no-store", signal: controller.signal });
    if (!res.ok) return null;

    const ct = safeTrim(res.headers.get("content-type")) || "application/octet-stream";
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);

    const ext =
      ct.includes("png") ? "png" : ct.includes("jpeg") || ct.includes("jpg") ? "jpg" : ct.includes("webp") ? "webp" : "bin";

    const file = await toFile(buf, `input.${ext}`, { type: ct });
    return { file, contentType: ct, bytes: buf.length };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function renderTemplate(template: string, vars: Record<string, string>) {
  const t = String(template ?? "");
  if (!t.trim()) return "";
  return t.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) return String(vars[key] ?? "");
    return m;
  });
}

function safeLine(label: string, value: string) {
  const v = safeTrim(value);
  return v ? `${label}: ${v}` : "";
}

function extractIndustryRenderFields(packAny: any): { addendum: string; negative: string } {
  if (!packAny) return { addendum: "", negative: "" };

  const addendum =
    safeTrim(packAny?.prompts?.renderPromptAddendum) ||
    safeTrim(packAny?.renderPromptAddendum) ||
    safeTrim(packAny?.prompts?.renderSystemAddendum) ||
    safeTrim(packAny?.prompts?.render_prompt_addendum) ||
    safeTrim(packAny?.prompts?.renderPromptTemplate) ||
    safeTrim(packAny?.renderPromptTemplate) ||
    "";

  const negative =
    safeTrim(packAny?.prompts?.renderNegativeGuidance) ||
    safeTrim(packAny?.renderNegativeGuidance) ||
    safeTrim(packAny?.prompts?.render_negative_guidance) ||
    "";

  return { addendum, negative };
}

function extractTenantRenderFields(ctx: any, resolved: any) {
  const tenantStyleKey = safeTrim(ctx?.rendering_style) || safeTrim(resolved?.tenant?.tenantStyleKey) || "photoreal";
  const tenantRenderNotes = safeTrim(ctx?.rendering_notes) || safeTrim(resolved?.tenant?.tenantRenderNotes) || "";
  const tenantAddendum = safeTrim(ctx?.rendering_prompt_addendum) || "";
  const tenantNegative = safeTrim(ctx?.rendering_negative_guidance) || "";
  return { tenantStyleKey, tenantRenderNotes, tenantAddendum, tenantNegative };
}

function buildJobContextFallback(args: { shopNotes: string; quoteId: string; versionNum?: number | null }) {
  const parts: string[] = [];
  const sn = safeTrim(args.shopNotes);
  if (sn) parts.push(`Shop notes:\n${sn}`);
  parts.push(`Quote: ${args.quoteId}${args.versionNum != null ? ` (v${args.versionNum})` : ""}`);
  return collapseBlankLines(parts.join("\n\n"));
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

  const claimed = await claimJobs(max);
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

  // Platform PCC config (templates/presets/etc.)
  const pcc = await loadPlatformLlmConfig();
  const platformRenderPreamble = safeTrim((pcc as any)?.prompts?.renderPromptPreamble) || "";
  const platformRenderTemplate = safeTrim((pcc as any)?.prompts?.renderPromptTemplate) || "";

  for (const job of claimed) {
    const jobDebugId = `${debugId}_${job.id.slice(0, 6)}`;

    try {
      // make quote show “running” immediately (legacy)
      try {
        await markQuoteRunning({ tenantId: job.tenantId, quoteLogId: job.quoteLogId });
      } catch {
        // ignore
      }

      const ctx = await loadRenderContext({
        tenantId: job.tenantId,
        quoteLogId: job.quoteLogId,
        quoteVersionId: job.quoteVersionId,
      });
      if (!ctx) throw new Error("Missing tenant/quote context for render attempt.");

      // Ensure version belongs to quote+tenant (defensive)
      if (!ctx.quote_version_id) throw new Error("Missing quote_version context (bad quoteVersionId).");

      const tenantSlug = String(ctx.tenant_slug ?? "");
      const tenantName = String(ctx.tenant_name ?? "Your Business");

      // Resolve tenant + AI settings (authoritative)
      const resolved = await resolveTenantLlm(job.tenantId);
      const renderModel = safeTrim(resolved.models.renderModel) || "gpt-image-1";

      const tenantRenderEnabled = coalesceTenantRenderEnabled(ctx, resolved.tenant.tenantRenderEnabled);
      if (tenantRenderEnabled === false) {
        const msg = "Rendering disabled by tenant settings.";

        await updateQuoteFailed({
          tenantId: job.tenantId,
          quoteLogId: job.quoteLogId,
          prompt: job.prompt || msg,
          error: msg,
        });

        await markRenderRowDone({ renderId: job.id, status: "failed", error: msg, prompt: job.prompt || null });
        processed.push({ renderId: job.id, quoteLogId: job.quoteLogId, ok: false, error: "TENANT_RENDERING_DISABLED" });
        continue;
      }

      // Rate limit enforcement (0 = unlimited)
      const maxPerDay = normalizeMaxPerDay(ctx.rendering_max_per_day);
      const rate = await isRateLimitedNow({ tenantId: job.tenantId, maxPerDay });

      if (rate.limited) {
        const msg = `Renderings are disabled by rate limit (max per day = ${rate.maxPerDay}).`;

        await updateQuoteFailed({
          tenantId: job.tenantId,
          quoteLogId: job.quoteLogId,
          prompt: job.prompt || msg,
          error: msg,
        });

        await markRenderRowDone({ renderId: job.id, status: "failed", error: msg, prompt: job.prompt || null });
        processed.push({
          renderId: job.id,
          quoteLogId: job.quoteLogId,
          ok: false,
          error: "RATE_LIMITED",
          maxPerDay: rate.maxPerDay,
          usedToday: (rate as any).usedToday ?? null,
        });
        continue;
      }

      const quoteInputAny: any = safeJsonParse(ctx.quote_input) ?? {};
      const quoteOutputAny: any = safeJsonParse(ctx.quote_output) ?? {};

      // Prefer version output (this is the *point* of lifecycle)
      const versionOutputAny: any = safeJsonParse(ctx.version_output) ?? null;
      const outputAny: any = versionOutputAny ?? quoteOutputAny ?? {};

      const optIn =
        Boolean(ctx.render_opt_in) ||
        Boolean(quoteInputAny?.render_opt_in) ||
        Boolean(quoteInputAny?.customer_context?.render_opt_in);

      if (!optIn) {
        // If not opted-in: mark the render row as failed (or you can choose "done"/"skipped"; table enum is yours)
        const msg = "Customer did not opt-in to rendering.";
        await markRenderRowDone({ renderId: job.id, status: "failed", error: msg, prompt: job.prompt || null });
        processed.push({ renderId: job.id, quoteLogId: job.quoteLogId, ok: true, skipped: true, reason: "not_opted_in" });
        continue;
      }

      const images = Array.isArray(quoteInputAny?.images) ? quoteInputAny.images : [];
      if (!images.length) {
        const msg = "No images stored on quote.";

        await updateQuoteFailed({
          tenantId: job.tenantId,
          quoteLogId: job.quoteLogId,
          prompt: job.prompt || msg,
          error: msg,
        });

        await markRenderRowDone({ renderId: job.id, status: "failed", error: msg, prompt: job.prompt || null });
        processed.push({ renderId: job.id, quoteLogId: job.quoteLogId, ok: false, error: "NO_IMAGES" });
        continue;
      }

      // Key policy:
      const enc = ctx.openai_key_enc;
      const hasTenantKey = Boolean(enc);
      const platformKey = safeTrim(process.env.OPENAI_API_KEY);
      const hasPlatformKey = Boolean(platformKey);

      const grace = graceRemaining(ctx.plan_tier, ctx.activation_grace_credits, ctx.activation_grace_used);
      const graceRemainingCount = grace.eligibleTier ? Number(grace.remaining ?? 0) : 0;

      const canUsePlatformGrace = !hasTenantKey && grace.inGrace && hasPlatformKey;

      if (!hasTenantKey && !canUsePlatformGrace) {
        const why =
          !hasPlatformKey
            ? "Missing platform OpenAI key (OPENAI_API_KEY)."
            : grace.eligibleTier
            ? "Grace exhausted for rendering."
            : "Missing tenant OpenAI key (tenant_secrets.openai_key_enc).";

        await updateQuoteFailed({
          tenantId: job.tenantId,
          quoteLogId: job.quoteLogId,
          prompt: job.prompt || why,
          error: why,
        });

        await markRenderRowDone({ renderId: job.id, status: "failed", error: why, prompt: job.prompt || null });
        processed.push({
          renderId: job.id,
          quoteLogId: job.quoteLogId,
          ok: false,
          error: "KEY_POLICY_BLOCK",
          planTier: safeTrim(ctx.plan_tier) || null,
          graceEligibleTier: grace.eligibleTier,
          graceRemaining: grace.eligibleTier ? graceRemainingCount : null,
          hasTenantKey,
          hasPlatformKey,
        });
        continue;
      }

      const apiKey = hasTenantKey ? decryptSecret(String(enc)) : platformKey;
      if (!apiKey) throw new Error(hasTenantKey ? "Unable to decrypt tenant OpenAI key." : "Missing platform OpenAI key.");

      // Resolve industry key
      const industryKey =
        safeTrim(ctx.industry_key).toLowerCase() || safeTrim(resolved?.meta?.industryKey).toLowerCase() || "";

      // Industry pack (DB preferred)
      let industrySource: "db" | "platform_fallback" | "none" = "none";
      let industryVersion: number | null = null;
      let industryAddendum = "";
      let industryNegative = "";

      if (industryKey) {
        try {
          const got = await getIndustryLlmPackWithMeta(industryKey);
          const fields = extractIndustryRenderFields(got?.pack);
          industryAddendum = fields.addendum;
          industryNegative = fields.negative;

          if (industryAddendum || industryNegative) {
            industrySource = "db";
            industryVersion = typeof got?.meta?.version === "number" ? got.meta.version : null;
          } else {
            const fallbackPack: any = (pcc as any)?.prompts?.industryPromptPacks?.[industryKey] ?? null;
            const fb = extractIndustryRenderFields(fallbackPack);
            if (fb.addendum || fb.negative) {
              industryAddendum = fb.addendum;
              industryNegative = fb.negative;
              industrySource = "platform_fallback";
            }
          }
        } catch {
          const fallbackPack: any = (pcc as any)?.prompts?.industryPromptPacks?.[industryKey] ?? null;
          const fb = extractIndustryRenderFields(fallbackPack);
          if (fb.addendum || fb.negative) {
            industryAddendum = fb.addendum;
            industryNegative = fb.negative;
            industrySource = "platform_fallback";
          }
        }
      }

      // Tenant fields
      const { tenantStyleKey, tenantRenderNotes, tenantAddendum, tenantNegative } = extractTenantRenderFields(ctx, resolved);

      // Style presets
      const presets = ((pcc as any)?.prompts?.renderStylePresets ?? {}) as any;
      const presetText =
        tenantStyleKey === "clean_oem"
          ? safeTrim(presets.clean_oem)
          : tenantStyleKey === "custom"
          ? safeTrim(presets.custom)
          : safeTrim(presets.photoreal);

      const styleText = presetText || "photorealistic, natural colors, clean lighting, product photography look, high detail";

      // Template lines
      const serviceTypeLine = safeLine(
        "Service type",
        safeTrim(quoteInputAny?.customer_context?.service_type) || safeTrim(quoteInputAny?.customer_context?.category) || ""
      );

      const summaryLine = safeLine("Estimate summary", typeof outputAny?.summary === "string" ? outputAny.summary : "");

      const customerNotesLine = safeLine(
        "Customer notes",
        String(quoteInputAny?.customer_context?.notes ?? "").trim()
      );

      const tenantRenderNotesLine = safeLine("Tenant render notes", tenantRenderNotes);

      // Compose preamble (platform + industry + tenant)
      const renderPromptPreamble = collapseBlankLines(
        [
          platformRenderPreamble,
          industryKey ? `Industry key: ${industryKey}` : "",
          industryAddendum ? `Industry addendum:\n${industryAddendum}` : "",
          tenantAddendum ? `Tenant addendum:\n${tenantAddendum}` : "",
        ]
          .filter(Boolean)
          .join("\n\n")
      );

      const negativeParts: string[] = [];
      if (industryNegative) negativeParts.push(`Industry negatives:\n${industryNegative}`);
      if (tenantNegative) negativeParts.push(`Tenant negatives:\n${tenantNegative}`);

      const negativeBlock = negativeParts.length
        ? collapseBlankLines(["Hard negatives (must avoid):", ...negativeParts].join("\n\n"))
        : "";

      // Job context:
      // - prefer the prompt already stored on quote_renders (if any)
      // - else fallback to shop_notes + quote/version identity
      const versionNum =
        typeof ctx.quote_version_num === "number" ? Number(ctx.quote_version_num) : Number(ctx.quote_version_num ?? 0) || null;

      const jobContext = safeTrim(job.prompt) || buildJobContextFallback({ shopNotes: job.shopNotes, quoteId: job.quoteLogId, versionNum });

      // Use platform template if present; fallback to composed body
      const templateVars = {
        renderPromptPreamble,
        style: styleText,
        serviceTypeLine,
        summaryLine,
        customerNotesLine,
        tenantRenderNotesLine,
      };

      const templatedBodyRaw = platformRenderTemplate ? renderTemplate(platformRenderTemplate, templateVars) : "";
      const templatedBody = collapseBlankLines(templatedBodyRaw);

      const fallbackBody = collapseBlankLines(
        [
          renderPromptPreamble,
          `Style: ${styleText}`,
          serviceTypeLine,
          summaryLine,
          customerNotesLine,
          tenantRenderNotesLine,
        ]
          .filter(Boolean)
          .join("\n")
      );

      const coreBody = templatedBody || fallbackBody;

      const finalPrompt = collapseBlankLines(
        [
          coreBody,
          negativeBlock,
          jobContext ? `Job context (must honor):\n${jobContext}` : "",
          "Output: one high-quality image. No text, no watermarks, no logos, no UI overlays.",
        ]
          .filter(Boolean)
          .join("\n\n")
      );

      if (debugEnabled) {
        const renderDebug: any = {
          ...buildRenderDebugPayload({
            debugId: jobDebugId,
            renderModel,
            tenantStyleKey,
            styleText,
            renderPromptPreamble,
            renderPromptTemplate: platformRenderTemplate
              ? "(platform) renderPromptTemplate applied"
              : "(fallback) no renderPromptTemplate configured",
            finalPrompt,
            serviceType:
              safeTrim(quoteInputAny?.customer_context?.service_type) ||
              safeTrim(quoteInputAny?.customer_context?.category) ||
              "",
            summary: typeof outputAny?.summary === "string" ? outputAny.summary : "",
            customerNotes: String(quoteInputAny?.customer_context?.notes ?? "").trim(),
            tenantRenderNotes,
            images,
          }),
          layers: {
            platform: {
              hasPreamble: Boolean(platformRenderPreamble),
              hasTemplate: Boolean(platformRenderTemplate),
              templateApplied: Boolean(templatedBody),
            },
            industry: {
              industryKey: industryKey || null,
              source: industrySource,
              version: industryVersion,
              renderPromptAddendumLen: industryAddendum ? industryAddendum.length : 0,
              renderNegativeGuidanceLen: industryNegative ? industryNegative.length : 0,
            },
            tenant: {
              renderNotesLen: tenantRenderNotes ? tenantRenderNotes.length : 0,
              promptAddendumLen: tenantAddendum ? tenantAddendum.length : 0,
              negativeGuidanceLen: tenantNegative ? tenantNegative.length : 0,
            },
          },
          keyPolicy: {
            used: hasTenantKey ? "tenant" : "platform_grace",
            planTier: safeTrim(ctx.plan_tier) || null,
            graceEligibleTier: grace.eligibleTier,
            graceRemaining: grace.eligibleTier ? graceRemainingCount : null,
            inGrace: grace.inGrace,
            hasTenantKey,
            hasPlatformKey,
          },
          rateLimit: {
            maxPerDay,
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

      // OpenAI image generation (anchor to first customer photo if possible)
      const openai = new OpenAI({
        apiKey,
        timeout: 90_000,
        maxRetries: 1,
      } as any);

      const inputUrl = pickFirstImageUrl(images);
      const inputFile = await fetchImageAsFile(inputUrl);

      let b64: string | undefined;

      if (inputFile?.file) {
        const editResp: any = await openai.images.edit({
          model: renderModel,
          image: inputFile.file,
          prompt: finalPrompt,
          size: "1024x1024",
        });

        b64 = editResp?.data?.[0]?.b64_json;
      } else {
        const genResp: any = await openai.images.generate({
          model: renderModel,
          prompt: finalPrompt,
          size: "1024x1024",
        });

        b64 = genResp?.data?.[0]?.b64_json;
      }

      if (!b64) throw new Error("Image generation returned no b64_json.");

      const bytes = Buffer.from(b64, "base64");

      const key = `renders/${tenantSlug}/${job.quoteLogId}-${job.quoteVersionId}-${job.attempt}-${Date.now()}.png`;
      const blob = await put(key, bytes, { access: "public", contentType: "image/png" });
      const imageUrl = blob?.url;
      if (!imageUrl) throw new Error("Blob upload returned no url.");

      // ✅ Persist render attempt row (new lifecycle)
      await markRenderRowDone({
        renderId: job.id,
        status: "rendered",
        imageUrl,
        prompt: finalPrompt,
        error: null,
      });

      await selectThisAttempt({ tenantId: job.tenantId, quoteVersionId: job.quoteVersionId, renderId: job.id });

      // ✅ Also update legacy quote_logs so existing UI + emails keep working
      await updateQuoteRendered({ tenantId: job.tenantId, quoteLogId: job.quoteLogId, imageUrl, prompt: finalPrompt });

      // Consume 1 grace credit on success
      if (!hasTenantKey && canUsePlatformGrace) {
        await bumpGraceUsedIfGraceTier(job.tenantId);
      }

      // Emails (best-effort) — unchanged from your existing behavior
      try {
        const cfg = await getTenantEmailConfig(job.tenantId);
        const businessName = (cfg.businessName || ctx.business_name || tenantName || "Your Business").trim();
        const brandLogoUrl = ctx.brand_logo_url ?? null;

        const brandLogoVariantRaw = String((ctx as any)?.brand_logo_variant ?? "").trim().toLowerCase();
        const brandLogoVariant =
          brandLogoVariantRaw === "light" ? "light" : brandLogoVariantRaw === "dark" ? "dark" : null;

        const customer = quoteInputAny?.customer ?? quoteInputAny?.contact ?? null;
        const customerName = String(customer?.name ?? "Customer").trim();
        const customerEmail = String(customer?.email ?? "").trim().toLowerCase();
        const customerPhone = String(customer?.phone ?? "").trim();

        const estimateLow = typeof outputAny?.estimate_low === "number" ? outputAny.estimate_low : null;
        const estimateHigh = typeof outputAny?.estimate_high === "number" ? outputAny.estimate_high : null;
        const summary = typeof outputAny?.summary === "string" ? outputAny.summary : "";

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

      processed.push({
        renderId: job.id,
        quoteLogId: job.quoteLogId,
        quoteVersionId: job.quoteVersionId,
        attempt: job.attempt,
        ok: true,
        imageUrl,
        renderModel,
        industryKey: industryKey || null,
        industrySource,
        usedKey: hasTenantKey ? "tenant" : "platform_grace",
        anchoredToInputImage: Boolean(inputFile?.file),
      });
    } catch (e: any) {
      const msg = safeErr(e);

      try {
        await updateQuoteFailed({
          tenantId: job.tenantId,
          quoteLogId: job.quoteLogId,
          prompt: job.prompt || "render_failed",
          error: msg,
        });
      } catch {
        // ignore
      }

      try {
        await markRenderRowDone({
          renderId: job.id,
          status: "failed",
          error: msg,
          prompt: job.prompt || null,
        });
      } catch {
        // ignore
      }

      processed.push({ renderId: job.id, quoteLogId: job.quoteLogId, ok: false, error: msg });
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