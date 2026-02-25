// src/app/api/tenant/llm/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";

import { requireTenantRole } from "@/lib/auth/tenant";
import { getPlatformLlm } from "@/lib/pcc/llm/apply";

import { getTenantLlmOverrides, upsertTenantLlmOverrides } from "@/lib/pcc/llm/tenantStore";
import { normalizeTenantOverrides, type TenantLlmOverrides } from "@/lib/pcc/llm/tenantTypes";

import { buildEffectiveLlmConfig } from "@/lib/pcc/llm/effective";
import { getIndustryLlmPack } from "@/lib/pcc/llm/industryStore";

import { db } from "@/lib/db/client";
import { tenantSettings } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function safeLower(v: unknown) {
  return safeTrim(v).toLowerCase();
}

/**
 * Minimal runtime guard for the platform cfg shape expected by buildEffectiveLlmConfig.
 * getPlatformLlm() may return { cfg, models, prompts, guardrails } or a raw cfg depending on branch.
 */
function normalizePlatformCfg(platformAny: any) {
  const cfg = platformAny?.cfg ?? platformAny;

  const ok =
    cfg &&
    typeof cfg === "object" &&
    typeof cfg.version === "number" &&
    typeof cfg.updatedAt === "string" &&
    cfg.models &&
    typeof cfg.models === "object" &&
    typeof cfg.models.estimatorModel === "string" &&
    typeof cfg.models.qaModel === "string" &&
    cfg.prompts &&
    typeof cfg.prompts === "object" &&
    typeof cfg.prompts.quoteEstimatorSystem === "string" &&
    typeof cfg.prompts.qaQuestionGeneratorSystem === "string" &&
    cfg.guardrails &&
    typeof cfg.guardrails === "object" &&
    Array.isArray(cfg.guardrails.blockedTopics) &&
    typeof cfg.guardrails.maxQaQuestions === "number";

  if (!ok) {
    const e: any = new Error("PLATFORM_LLM_CONFIG_INVALID");
    e.code = "PLATFORM_LLM_CONFIG_INVALID";
    throw e;
  }

  return cfg as any;
}

const GetQuery = z.object({
  tenantId: z.string().uuid(),
  industryKey: z.string().optional().nullable(),
});

const OverridesSchema = z.object({
  updatedAt: z.string().optional().nullable(),
  models: z
    .object({
      estimatorModel: z.string().optional(),
      qaModel: z.string().optional(),
      renderModel: z.string().optional(),
    })
    .optional(),
  prompts: z
    .object({
      extraSystemPreamble: z.string().optional(),
      quoteEstimatorSystem: z.string().optional(),
      qaQuestionGeneratorSystem: z.string().optional(),
    })
    .optional(),
  maxQaQuestions: z.number().int().min(1).max(10).optional(),
});

const PostBody = z.object({
  tenantId: z.string().uuid(),
  industryKey: z.string().optional().nullable(),
  overrides: OverridesSchema,
});

/**
 * ✅ Source of truth for industry key:
 * - Prefer explicit query param (when present)
 * - Otherwise resolve from tenant_settings for the ACTIVE tenant
 */
async function resolveIndustryKeyForTenant(args: {
  tenantId: string;
  industryKeyFromCaller: string | null;
}): Promise<string | null> {
  const fromCaller = safeLower(args.industryKeyFromCaller);
  if (fromCaller) return fromCaller;

  const row = await db
    .select({ industryKey: tenantSettings.industryKey })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, args.tenantId as any))
    .limit(1)
    .then((r) => r[0] ?? null);

  const fromDb = safeLower(row?.industryKey ?? "");
  return fromDb || null;
}

function keysOf(obj: any): string[] {
  if (!obj || typeof obj !== "object") return [];
  return Object.keys(obj);
}

function pickFirstString(obj: any, keys: string[]) {
  if (!obj || typeof obj !== "object") return "";
  for (const k of keys) {
    const v = (obj as any)[k];
    const s = safeTrim(v);
    if (typeof v === "string" && s) return s;
  }
  return "";
}

/**
 * ✅ Normalize industry packs into the "industry layer" shape that buildEffectiveLlmConfig expects.
 *
 * We accept multiple historical key names inside the selected pack entry:
 * - Text prompts:
 *   - quoteEstimatorSystem, qaQuestionGeneratorSystem, extraSystemPreamble
 *
 * - Render prompts:
 *   Industry editor UX uses "Render system addendum" + "Render negative guidance".
 *   Those may be stored as:
 *     renderSystemAddendum / renderNegativeGuidance
 *   or legacy variants:
 *     renderPromptPreamble / renderPromptTemplate
 *     render_prompt_addendum / rendering_negative_guidance
 *
 * We flatten the selected entry into:
 *   industry.prompts.quoteEstimatorSystem / qaQuestionGeneratorSystem / extraSystemPreamble
 * and keep render-specific fields on industry.prompts too for downstream tooling.
 */
function normalizeIndustryLayer(args: {
  resolvedIndustryKey: string | null;
  pack: any | null;
}): { industry: any; selectedPackEntry: any | null; packTopKeys: string[]; packPromptKeys: string[] } {
  const pack = args.pack && typeof args.pack === "object" ? args.pack : null;
  const industry: any = pack ? { ...pack } : { models: {}, prompts: {}, guardrails: {} };

  if (!industry.models || typeof industry.models !== "object") industry.models = {};
  if (!industry.prompts || typeof industry.prompts !== "object") industry.prompts = {};
  if (!industry.guardrails || typeof industry.guardrails !== "object") industry.guardrails = {};

  const resolvedKey = safeLower(args.resolvedIndustryKey);
  const promptPacks = (industry.prompts as any)?.industryPromptPacks;

  if (!promptPacks || typeof promptPacks !== "object") {
    return {
      industry,
      selectedPackEntry: null,
      packTopKeys: keysOf(industry),
      packPromptKeys: keysOf(industry.prompts),
    };
  }

  const entry = resolvedKey ? (promptPacks as any)[resolvedKey] : null;
  const selectedPackEntry = entry && typeof entry === "object" ? entry : null;

  if (selectedPackEntry) {
    // --- Text prompt fields (effective builder expects these) ---
    const qe = pickFirstString(selectedPackEntry, ["quoteEstimatorSystem"]);
    const qa = pickFirstString(selectedPackEntry, ["qaQuestionGeneratorSystem"]);
    const pre = pickFirstString(selectedPackEntry, ["extraSystemPreamble"]);

    if (qe) industry.prompts.quoteEstimatorSystem = qe;
    if (qa) industry.prompts.qaQuestionGeneratorSystem = qa;
    if (pre) industry.prompts.extraSystemPreamble = pre;

    // --- Render fields (industry editor expects these) ---
    // Canonical / editor-friendly keys:
    const renderAddendum = pickFirstString(selectedPackEntry, [
      "renderSystemAddendum",
      "renderAddendum",
      "renderPromptAddendum",
      "render_prompt_addendum",
      "render_system_addendum",
    ]);

    const renderNeg = pickFirstString(selectedPackEntry, [
      "renderNegativeGuidance",
      "render_negative_guidance",
      "rendering_negative_guidance",
      "renderNegative",
      "renderNegatives",
    ]);

    if (renderAddendum) (industry.prompts as any).renderSystemAddendum = renderAddendum;
    if (renderNeg) (industry.prompts as any).renderNegativeGuidance = renderNeg;

    // Back-compat “preamble/template” storage (some branches used this)
    const rp = pickFirstString(selectedPackEntry, ["renderPromptPreamble", "render_prompt_preamble"]);
    const rt = pickFirstString(selectedPackEntry, ["renderPromptTemplate", "render_prompt_template"]);

    if (rp) (industry.prompts as any).renderPromptPreamble = rp;
    if (rt) (industry.prompts as any).renderPromptTemplate = rt;

    // If addendum exists but preamble not set, also treat addendum as preamble
    // so older render compilers still pick it up.
    if (renderAddendum && !safeTrim((industry.prompts as any).renderPromptPreamble)) {
      (industry.prompts as any).renderPromptPreamble = renderAddendum;
    }
  }

  return {
    industry,
    selectedPackEntry,
    packTopKeys: keysOf(industry),
    packPromptKeys: keysOf(industry.prompts),
  };
}

/**
 * Read tenant_settings row without guessing columns (select *).
 * This is intentionally tolerant: older DBs won’t break if new columns aren’t migrated yet.
 */
async function getTenantSettingsAnyRow(tenantId: string): Promise<any | null> {
  try {
    const r = await db.execute(sql`
      select *
      from tenant_settings
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);

    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
    return row ?? null;
  } catch {
    return null;
  }
}

function joinNonEmpty(parts: Array<string | null | undefined>, sep = "\n\n") {
  return parts.map((p) => safeTrim(p)).filter(Boolean).join(sep);
}

/**
 * Build a stable read-only "effective.rendering" view for the UI.
 * This is intentionally schema-tolerant and should NOT require
 * the effective-builder to know about render pack details.
 */
function buildEffectiveRendering(args: {
  platformCfg: any;
  industry: any;
  effective: any;
  tenantSettingsRow: any | null;
}) {
  const platformCfg = args.platformCfg ?? {};
  const industry = args.industry ?? {};
  const effective = args.effective ?? {};
  const ts = args.tenantSettingsRow ?? null;

  const renderModel =
    safeTrim(effective?.models?.renderModel) || safeTrim(platformCfg?.models?.renderModel) || "gpt-image-1";

  const platformPreamble = safeTrim(platformCfg?.prompts?.renderPromptPreamble);
  const platformTemplate = safeTrim(platformCfg?.prompts?.renderPromptTemplate);

  // ✅ Industry addendum + negative guidance (what the industry editor collects)
  const industryAddendum =
    safeTrim((industry?.prompts as any)?.renderSystemAddendum) ||
    safeTrim((industry?.prompts as any)?.render_prompt_addendum) ||
    safeTrim((industry?.prompts as any)?.renderPromptPreamble);

  const industryNegativeGuidance =
    safeTrim((industry?.prompts as any)?.renderNegativeGuidance) ||
    safeTrim((industry?.prompts as any)?.render_negative_guidance) ||
    safeTrim((industry?.prompts as any)?.rendering_negative_guidance);

  // Keep these too (some render pipelines still treat these as “template” fields)
  const industryPreamble = safeTrim((industry?.prompts as any)?.renderPromptPreamble);
  const industryTemplate = safeTrim((industry?.prompts as any)?.renderPromptTemplate);

  // Tenant add-ons come from ai-policy (tenant_settings) if present.
  // Fallback to legacy rendering_notes so the UI never looks blank.
  const tenantAddendum = safeTrim(ts?.rendering_prompt_addendum) || safeTrim(ts?.rendering_notes);
  const tenantNegativeGuidance = safeTrim(ts?.rendering_negative_guidance);

  const compiledPromptFromApi = safeTrim((effective as any)?.rendering?.compiledPrompt);

  const compiledFallback = joinNonEmpty(
    [
      platformPreamble && `# Platform render preamble\n${platformPreamble}`,
      industryAddendum && `# Industry render addendum\n${industryAddendum}`,
      industryNegativeGuidance && `# Industry render negative guidance\n${industryNegativeGuidance}`,
      platformTemplate && `# Platform render template\n${platformTemplate}`,
      industryTemplate && `# Industry render template\n${industryTemplate}`,
      tenantAddendum && `# Tenant add-on\n${tenantAddendum}`,
      tenantNegativeGuidance && `# Avoid / negative guidance\n${tenantNegativeGuidance}`,
    ],
    "\n\n"
  );

  const compiledPrompt = compiledPromptFromApi || compiledFallback || "";

  return {
    model: renderModel,

    // platform baseline
    platformPreamble: platformPreamble || undefined,
    platformTemplate: platformTemplate || undefined,

    // ✅ what tenant UI expects
    industryAddendum: industryAddendum || undefined,
    industryNegativeGuidance: industryNegativeGuidance || undefined,

    // keep legacy-ish visibility too (helpful for debugging)
    industryPreamble: industryPreamble || undefined,
    industryTemplate: industryTemplate || undefined,

    // tenant add-ons
    tenantAddendum: tenantAddendum || undefined,
    tenantNegativeGuidance: tenantNegativeGuidance || undefined,

    // compiled prompt
    compiledPrompt: compiledPrompt || undefined,

    // metadata
    platformVersion: typeof platformCfg?.version === "number" ? platformCfg.version : undefined,
    industryVersion: typeof industry?.version === "number" ? industry.version : undefined,
  };
}

export async function GET(req: Request) {
  const gate = await requireTenantRole(["owner", "admin", "member"]);
  if (!gate.ok) return json({ ok: false, error: gate.error, message: gate.message }, gate.status);

  const url = new URL(req.url);
  const parsed = GetQuery.safeParse({
    tenantId: url.searchParams.get("tenantId"),
    industryKey: url.searchParams.get("industryKey"),
  });

  if (!parsed.success) {
    return json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, 400);
  }

  // do not trust caller tenantId; must match active tenant context
  if (parsed.data.tenantId !== gate.tenantId) {
    return json({ ok: false, error: "FORBIDDEN", message: "Tenant mismatch." }, 403);
  }

  try {
    const platformAny: any = await getPlatformLlm();
    const platformCfg = normalizePlatformCfg(platformAny);

    const resolvedIndustryKey = await resolveIndustryKeyForTenant({
      tenantId: gate.tenantId,
      industryKeyFromCaller: safeTrim(parsed.data.industryKey) || null,
    });

    const rawPack = await getIndustryLlmPack(resolvedIndustryKey);

    // ✅ flatten nested pack shape into effective-builder shape (+ render keys)
    const normalized = normalizeIndustryLayer({ resolvedIndustryKey, pack: rawPack });
    const industry = normalized.industry;

    const row = await getTenantLlmOverrides(gate.tenantId);

    const tenantOverrides: TenantLlmOverrides | null = row
      ? normalizeTenantOverrides({
          models: (row as any).models ?? {},
          prompts: (row as any).prompts ?? {},
          updatedAt: (row as any).updatedAt ?? undefined,
          maxQaQuestions: (row as any).maxQaQuestions ?? undefined,
        } as any)
      : null;

    const bundle = buildEffectiveLlmConfig({
      platform: platformCfg,
      industry,
      tenant: tenantOverrides,
    });

    const baselineBundle = buildEffectiveLlmConfig({
      platform: platformCfg,
      industry,
      tenant: null,
    });

    // ✅ read tenant_settings once (tolerant select *)
    const tenantSettingsRow = await getTenantSettingsAnyRow(gate.tenantId);

    // ✅ build render effective view (platform + industry + tenant add-ons)
    const effectiveRendering = buildEffectiveRendering({
      platformCfg,
      industry,
      effective: bundle.effective,
      tenantSettingsRow,
    });

    // attach a small read-only “renderingPolicy” object for UI convenience
    const renderingPolicy = {
      enabled: Boolean(tenantSettingsRow?.ai_rendering_enabled ?? tenantSettingsRow?.rendering_enabled ?? false),
      style: safeTrim(tenantSettingsRow?.rendering_style) || undefined,
      promptAddendum:
        safeTrim(tenantSettingsRow?.rendering_prompt_addendum) || safeTrim(tenantSettingsRow?.rendering_notes) || undefined,
      negativeGuidance: safeTrim(tenantSettingsRow?.rendering_negative_guidance) || undefined,
    };

    return json({
      ok: true,
      platform: platformCfg,
      industry,
      tenant: tenantOverrides ? ({ ...tenantOverrides, renderingPolicy } as any) : ({ renderingPolicy } as any),
      effective: { ...(bundle.effective as any), rendering: effectiveRendering },
      effectiveBase: baselineBundle.effective,
      permissions: {
        role: gate.role,
        canEdit: gate.role === "owner" || gate.role === "admin",
      },
      debug: {
        resolvedIndustryKey,
        packFound: Boolean(rawPack),
        packTopKeys: normalized.packTopKeys,
        packPromptKeys: normalized.packPromptKeys,
        selectedPackKeys: normalized.selectedPackEntry ? keysOf(normalized.selectedPackEntry) : [],
        mergedPromptKeys: keysOf((bundle.effective as any)?.prompts ?? {}),
        render: {
          hasTenantSettingsRow: Boolean(tenantSettingsRow),
          tenantSettingsKeys: tenantSettingsRow ? keysOf(tenantSettingsRow).slice(0, 50) : [],
          hasPlatformRenderPreamble: Boolean(safeTrim(platformCfg?.prompts?.renderPromptPreamble)),
          hasPlatformRenderTemplate: Boolean(safeTrim(platformCfg?.prompts?.renderPromptTemplate)),
          hasIndustryAddendum: Boolean(safeTrim((effectiveRendering as any)?.industryAddendum)),
          hasIndustryNegative: Boolean(safeTrim((effectiveRendering as any)?.industryNegativeGuidance)),
          hasTenantAddendum: Boolean(renderingPolicy.promptAddendum),
          hasTenantNegative: Boolean(renderingPolicy.negativeGuidance),
          compiledFrom: safeTrim((bundle.effective as any)?.rendering?.compiledPrompt) ? "api" : "fallback",
        },
      },
    });
  } catch (e: any) {
    return json(
      {
        ok: false,
        error: e?.code || "LOAD_FAILED",
        message: e?.message ?? String(e),
      },
      500
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) return json({ ok: false, error: gate.error, message: gate.message }, gate.status);

  const body = await req.json().catch(() => null);
  const parsed = PostBody.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, 400);
  }

  if (parsed.data.tenantId !== gate.tenantId) {
    return json({ ok: false, error: "FORBIDDEN", message: "Tenant mismatch." }, 403);
  }

  try {
    const platformAny: any = await getPlatformLlm();
    const platformCfg = normalizePlatformCfg(platformAny);

    const resolvedIndustryKey = await resolveIndustryKeyForTenant({
      tenantId: gate.tenantId,
      industryKeyFromCaller: safeTrim(parsed.data.industryKey) || null,
    });

    const rawPack = await getIndustryLlmPack(resolvedIndustryKey);
    const normalized = normalizeIndustryLayer({ resolvedIndustryKey, pack: rawPack });
    const industry = normalized.industry;

    const incoming = parsed.data.overrides ?? ({} as any);

    const normalizedOverrides: TenantLlmOverrides = normalizeTenantOverrides({
      models: incoming.models ?? {},
      prompts: incoming.prompts ?? {},
      updatedAt: incoming.updatedAt ?? undefined,
      maxQaQuestions: incoming.maxQaQuestions ?? undefined,
    } as any);

    await upsertTenantLlmOverrides({
      tenantId: gate.tenantId,
      models: normalizedOverrides.models ?? {},
      prompts: normalizedOverrides.prompts ?? {},
      updatedAt: normalizedOverrides.updatedAt ?? undefined,
      maxQaQuestions: normalizedOverrides.maxQaQuestions ?? undefined,
    } as any);

    const row = await getTenantLlmOverrides(gate.tenantId);

    const tenantOverrides: TenantLlmOverrides | null = row
      ? normalizeTenantOverrides({
          models: (row as any).models ?? {},
          prompts: (row as any).prompts ?? {},
          updatedAt: (row as any).updatedAt ?? undefined,
          maxQaQuestions: (row as any).maxQaQuestions ?? undefined,
        } as any)
      : null;

    const bundle = buildEffectiveLlmConfig({
      platform: platformCfg,
      industry,
      tenant: tenantOverrides,
    });

    const baselineBundle = buildEffectiveLlmConfig({
      platform: platformCfg,
      industry,
      tenant: null,
    });

    // ✅ same render effective view on POST response (so UI refreshes without extra round trip)
    const tenantSettingsRow = await getTenantSettingsAnyRow(gate.tenantId);

    const effectiveRendering = buildEffectiveRendering({
      platformCfg,
      industry,
      effective: bundle.effective,
      tenantSettingsRow,
    });

    const renderingPolicy = {
      enabled: Boolean(tenantSettingsRow?.ai_rendering_enabled ?? tenantSettingsRow?.rendering_enabled ?? false),
      style: safeTrim(tenantSettingsRow?.rendering_style) || undefined,
      promptAddendum:
        safeTrim(tenantSettingsRow?.rendering_prompt_addendum) || safeTrim(tenantSettingsRow?.rendering_notes) || undefined,
      negativeGuidance: safeTrim(tenantSettingsRow?.rendering_negative_guidance) || undefined,
    };

    return json({
      ok: true,
      tenant: tenantOverrides ? ({ ...tenantOverrides, renderingPolicy } as any) : ({ renderingPolicy } as any),
      effective: { ...(bundle.effective as any), rendering: effectiveRendering },
      effectiveBase: baselineBundle.effective,
      debug: {
        resolvedIndustryKey,
        packFound: Boolean(rawPack),
        packPromptKeys: normalized.packPromptKeys,
        selectedPackKeys: normalized.selectedPackEntry ? keysOf(normalized.selectedPackEntry) : [],
        mergedPromptKeys: keysOf((bundle.effective as any)?.prompts ?? {}),
        render: {
          hasTenantSettingsRow: Boolean(tenantSettingsRow),
          hasIndustryAddendum: Boolean(safeTrim((effectiveRendering as any)?.industryAddendum)),
          hasIndustryNegative: Boolean(safeTrim((effectiveRendering as any)?.industryNegativeGuidance)),
          compiledFrom: safeTrim((bundle.effective as any)?.rendering?.compiledPrompt) ? "api" : "fallback",
        },
      },
    });
  } catch (e: any) {
    return json(
      {
        ok: false,
        error: e?.code || "SAVE_FAILED",
        message: e?.message ?? String(e),
      },
      500
    );
  }
}