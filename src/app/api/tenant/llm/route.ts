// src/app/api/tenant/llm/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireTenantRole } from "@/lib/auth/tenant";
import { getPlatformLlm } from "@/lib/pcc/llm/apply";

import { getTenantLlmOverrides, upsertTenantLlmOverrides } from "@/lib/pcc/llm/tenantStore";
import { normalizeTenantOverrides, type TenantLlmOverrides } from "@/lib/pcc/llm/tenantTypes";

import { getIndustryDefaults, buildEffectiveLlmConfig } from "@/lib/pcc/llm/effective";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
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

  // NOTE: we intentionally do not trust caller tenantId; must match active tenant context
  if (parsed.data.tenantId !== gate.tenantId) {
    return json({ ok: false, error: "FORBIDDEN", message: "Tenant mismatch." }, 403);
  }

  try {
    const platformAny: any = await getPlatformLlm();
    const platformCfg = normalizePlatformCfg(platformAny);

    // Industry layer (stubbed to {} until DB-backed packs land)
    const industryKey = safeTrim(parsed.data.industryKey) || null;
    const industry = getIndustryDefaults(industryKey);

    // Tenant overrides row (jsonb)
    const row = await getTenantLlmOverrides(gate.tenantId);

    // IMPORTANT:
    // TenantLlmOverridesRow currently doesn't type maxQaQuestions, but older/newer schemas may store it.
    // So we read it safely from (row as any) to avoid TypeScript build breaks.
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

    // baseline = platform + industry only (no tenant)
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

    const industryKey = safeTrim(parsed.data.industryKey) || null;
    const industry = getIndustryDefaults(industryKey);

    // Normalize incoming overrides
    const incoming = parsed.data.overrides ?? ({} as any);

    const normalized: TenantLlmOverrides = normalizeTenantOverrides({
      models: incoming.models ?? {},
      prompts: incoming.prompts ?? {},
      updatedAt: incoming.updatedAt ?? undefined,
      maxQaQuestions: incoming.maxQaQuestions ?? undefined,
    } as any);

    // ✅ FIX: upsertTenantLlmOverrides expects ONE argument (object form).
    // Tenant store owns its schema; we pass tenantId + payload as a single object.
    await upsertTenantLlmOverrides({
      tenantId: gate.tenantId,
      models: normalized.models ?? {},
      prompts: normalized.prompts ?? {},
      updatedAt: normalized.updatedAt ?? undefined,
      maxQaQuestions: normalized.maxQaQuestions ?? undefined,
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