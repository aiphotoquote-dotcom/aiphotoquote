// src/app/api/tenant/llm/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireTenantRole } from "@/lib/auth/tenant";
import { getPlatformLlm } from "@/lib/pcc/llm/apply";
import { buildEffectiveLlmConfig } from "@/lib/pcc/llm/effective";
import { getTenantLlmOverrides, upsertTenantLlmOverrides } from "@/lib/pcc/llm/tenantStore";
import { normalizeTenantOverrides, type TenantLlmOverrides } from "@/lib/pcc/llm/tenantTypes";

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
 * Minimal runtime guard for platform cfg shape expected by buildEffectiveLlmConfig.
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

const PostBody = z.object({
  tenantId: z.string().uuid(),
  industryKey: z.string().optional().nullable(),
  overrides: z
    .object({
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
    })
    .optional()
    .nullable(),
});

export async function GET(req: Request) {
  const gate = await requireTenantRole(["owner", "admin", "member"]);
  if (!gate.ok) return json({ ok: false, error: gate.error, message: gate.message }, gate.status);

  const url = new URL(req.url);
  const parsedQ = GetQuery.safeParse({
    tenantId: url.searchParams.get("tenantId"),
    industryKey: url.searchParams.get("industryKey"),
  });
  if (!parsedQ.success) {
    return json({ ok: false, error: "BAD_REQUEST", message: "Invalid query", issues: parsedQ.error.issues }, 400);
  }

  // Must match active tenant context
  if (parsedQ.data.tenantId !== gate.tenantId) {
    return json({ ok: false, error: "FORBIDDEN", message: "Tenant mismatch." }, 403);
  }

  const platformAny: any = await getPlatformLlm();
  const platformCfg = normalizePlatformCfg(platformAny);

  // ✅ industry pack placeholder (DB-backed soon). No hardcoding.
  const industryKey = safeTrim(parsedQ.data.industryKey) || null;
  const industry: any = {};

  const row = await getTenantLlmOverrides(gate.tenantId);
  const tenant: TenantLlmOverrides | null = row
    ? normalizeTenantOverrides({
        models: row.models ?? {},
        prompts: row.prompts ?? {},
        updatedAt: row.updatedAt ?? undefined,
        maxQaQuestions: row.maxQaQuestions ?? undefined,
      } as any)
    : null;

  const effectiveBaseBundle = buildEffectiveLlmConfig({
    platform: platformCfg,
    industry,
    tenant: null,
  });

  const effectiveBundle = buildEffectiveLlmConfig({
    platform: platformCfg,
    industry,
    tenant,
  });

  const canEdit = gate.role === "owner" || gate.role === "admin";

  return json({
    ok: true,
    platform: platformCfg,
    industry,
    tenant,
    effectiveBase: effectiveBaseBundle.effective,
    effective: effectiveBundle.effective,
    permissions: {
      role: gate.role,
      canEdit,
    },
  });
}

export async function POST(req: Request) {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) return json({ ok: false, error: gate.error, message: gate.message }, gate.status);

  const body = await req.json().catch(() => null);
  const parsed = PostBody.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "BAD_REQUEST", message: "Invalid payload", issues: parsed.error.issues }, 400);
  }

  if (parsed.data.tenantId !== gate.tenantId) {
    return json({ ok: false, error: "FORBIDDEN", message: "Tenant mismatch." }, 403);
  }

  const overrides = parsed.data.overrides ?? null;

  // Persist tenant overrides (or clear if null/empty)
  const saved = await upsertTenantLlmOverrides(gate.tenantId, overrides);

  // Recompute effective after save
  const platformAny: any = await getPlatformLlm();
  const platformCfg = normalizePlatformCfg(platformAny);

  const industryKey = safeTrim(parsed.data.industryKey) || null;
  const industry: any = {};

  const tenant: TenantLlmOverrides | null = saved
    ? normalizeTenantOverrides({
        models: saved.models ?? {},
        prompts: saved.prompts ?? {},
        updatedAt: saved.updatedAt ?? undefined,
        maxQaQuestions: (saved as any).maxQaQuestions ?? undefined,
      } as any)
    : null;

  const effectiveBaseBundle = buildEffectiveLlmConfig({
    platform: platformCfg,
    industry,
    tenant: null,
  });

  const effectiveBundle = buildEffectiveLlmConfig({
    platform: platformCfg,
    industry,
    tenant,
  });

  return json({
    ok: true,
    tenant,
    effectiveBase: effectiveBaseBundle.effective,
    effective: effectiveBundle.effective,
  });
}