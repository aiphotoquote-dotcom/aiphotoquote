// src/app/api/tenant/llm/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";

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

/**
 * ✅ Normalize industry packs into the "industry layer" shape that buildEffectiveLlmConfig expects.
 *
 * Your DB pack currently returns:
 *   industry.prompts.industryPromptPacks[industryKey].quoteEstimatorSystem / qaQuestionGeneratorSystem / etc
 *
 * But effective builder expects:
 *   industry.prompts.quoteEstimatorSystem / qaQuestionGeneratorSystem / extraSystemPreamble
 *
 * So we flatten the selected pack entry into top-level prompts.
 */
function normalizeIndustryLayer(args: {
  resolvedIndustryKey: string | null;
  pack: any | null;
}): { industry: any; selectedPackEntry: any | null; packTopKeys: string[]; packPromptKeys: string[] } {
  const pack = args.pack && typeof args.pack === "object" ? args.pack : null;
  const industry: any = pack ? { ...pack } : { models: {}, prompts: {}, guardrails: {} };

  // Ensure objects exist
  if (!industry.models || typeof industry.models !== "object") industry.models = {};
  if (!industry.prompts || typeof industry.prompts !== "object") industry.prompts = {};
  if (!industry.guardrails || typeof industry.guardrails !== "object") industry.guardrails = {};

  const resolvedKey = safeLower(args.resolvedIndustryKey);
  const promptPacks = (industry.prompts as any)?.industryPromptPacks;

  // If no nested packs, nothing to do.
  if (!promptPacks || typeof promptPacks !== "object") {
    return {
      industry,
      selectedPackEntry: null,
      packTopKeys: keysOf(industry),
      packPromptKeys: keysOf(industry.prompts),
    };
  }

  // Pick the correct pack entry.
  const entry = resolvedKey ? (promptPacks as any)[resolvedKey] : null;
  const selectedPackEntry = entry && typeof entry === "object" ? entry : null;

  if (selectedPackEntry) {
    // Flatten the relevant prompt fields to what the effective builder expects.
    if (typeof selectedPackEntry.quoteEstimatorSystem === "string" && safeTrim(selectedPackEntry.quoteEstimatorSystem)) {
      industry.prompts.quoteEstimatorSystem = String(selectedPackEntry.quoteEstimatorSystem);
    }
    if (
      typeof selectedPackEntry.qaQuestionGeneratorSystem === "string" &&
      safeTrim(selectedPackEntry.qaQuestionGeneratorSystem)
    ) {
      industry.prompts.qaQuestionGeneratorSystem = String(selectedPackEntry.qaQuestionGeneratorSystem);
    }
    if (typeof selectedPackEntry.extraSystemPreamble === "string" && safeTrim(selectedPackEntry.extraSystemPreamble)) {
      industry.prompts.extraSystemPreamble = String(selectedPackEntry.extraSystemPreamble);
    }

    // (Optional) If later you decide to surface render addendums in the effective UI,
    // you can flatten those too — but we do NOT change effective shape here.
  }

  return {
    industry,
    selectedPackEntry,
    packTopKeys: keysOf(industry),
    packPromptKeys: keysOf(industry.prompts),
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

    // ✅ flatten nested pack shape into effective-builder shape
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

    return json({
      ok: true,
      platform: platformCfg,
      industry,
      tenant: tenantOverrides,
      effective: bundle.effective,
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

    return json({
      ok: true,
      tenant: tenantOverrides,
      effective: bundle.effective,
      effectiveBase: baselineBundle.effective,
      debug: {
        resolvedIndustryKey,
        packFound: Boolean(rawPack),
        packPromptKeys: normalized.packPromptKeys,
        selectedPackKeys: normalized.selectedPackEntry ? keysOf(normalized.selectedPackEntry) : [],
        mergedPromptKeys: keysOf((bundle.effective as any)?.prompts ?? {}),
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