// src/lib/pcc/llm/tenant.ts
import { tenantSettings } from "@/lib/db/schema";
import { db } from "@/lib/db/client";
import { eq } from "drizzle-orm";

import { getPlatformLlm } from "./apply";

/**
 * Tenant-aware LLM resolution.
 *
 * We don't have explicit per-tenant model columns in schema,
 * so we treat tenant_settings.aiMode as an override signal.
 *
 * Supported aiMode patterns:
 *  - "fast" | "balanced" | "quality"
 *  - "model:gpt-4o" (explicit)
 *  - "gpt-4o" (explicit)
 *
 * Safety: explicit models must be in allowlist (env) unless allowlist empty.
 */
function getModelAllowlist(): string[] | null {
  const raw = String(process.env.TENANT_MODEL_ALLOWLIST ?? "").trim();
  if (!raw) return null; // null => allow anything (not recommended, but intentional)
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : null;
}

function isAllowedModel(model: string, allowlist: string[] | null): boolean {
  const m = String(model ?? "").trim();
  if (!m) return false;
  if (allowlist == null) return true; // allow-all
  return allowlist.includes(m);
}

function parseAiMode(aiModeRaw: unknown): { kind: "preset" | "explicit" | "none"; value?: string } {
  const s = String(aiModeRaw ?? "").trim();
  if (!s) return { kind: "none" };

  const lower = s.toLowerCase();

  if (lower === "fast" || lower === "balanced" || lower === "quality") {
    return { kind: "preset", value: lower };
  }

  if (lower.startsWith("model:")) {
    const v = s.slice("model:".length).trim();
    return v ? { kind: "explicit", value: v } : { kind: "none" };
  }

  // If they typed a model name directly (e.g. "gpt-4o-mini")
  if (lower.startsWith("gpt-")) {
    return { kind: "explicit", value: s };
  }

  return { kind: "none" };
}

function resolvePresetModels(preset: "fast" | "balanced" | "quality", platformEstimator: string, platformQa: string) {
  // You can tweak these defaults later without schema changes.
  if (preset === "fast") {
    return { estimatorModel: "gpt-4o-mini", qaModel: "gpt-4o-mini" };
  }
  if (preset === "quality") {
    return { estimatorModel: "gpt-4o", qaModel: "gpt-4o-mini" };
  }
  // balanced
  return { estimatorModel: platformEstimator, qaModel: platformQa };
}

export async function getTenantEffectiveLlm(tenantId: string): Promise<{
  platform: Awaited<ReturnType<typeof getPlatformLlm>>;
  models: { estimatorModel: string; qaModel: string; renderModel: string };
  prompts: { quoteEstimatorSystem: string; qaQuestionGeneratorSystem: string };
  guardrails: Awaited<ReturnType<typeof getPlatformLlm>>["guardrails"];
  tenant: {
    aiMode: string | null;
    renderingStyle: string | null;
    renderingNotes: string | null;
    renderingCustomerOptInRequired: boolean;
    tenantRenderEnabled: boolean;
  };
  meta: {
    modelSource: "platform_default" | "tenant_preset" | "tenant_explicit" | "tenant_rejected_not_allowed";
  };
}> {
  const platform = await getPlatformLlm();

  const row = await db
    .select({
      aiMode: tenantSettings.aiMode,
      renderingStyle: tenantSettings.renderingStyle,
      renderingNotes: tenantSettings.renderingNotes,
      renderingCustomerOptInRequired: tenantSettings.renderingCustomerOptInRequired,
      aiRenderingEnabled: tenantSettings.aiRenderingEnabled,
      renderingEnabled: tenantSettings.renderingEnabled,
    })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId))
    .limit(1)
    .then((r) => r[0] ?? null);

  const aiMode = row?.aiMode ? String(row.aiMode).trim() : null;

  // render enabled: prefer aiRenderingEnabled, fallback to renderingEnabled
  const tenantRenderEnabled =
    row?.aiRenderingEnabled === true || row?.renderingEnabled === true ? true : false;

  const renderingStyle = row?.renderingStyle ? String(row.renderingStyle).trim() : null;
  const renderingNotes = row?.renderingNotes ? String(row.renderingNotes).trim() : null;

  const renderingCustomerOptInRequired = row?.renderingCustomerOptInRequired === true;

  // default to platform
  let estimatorModel = platform.models.estimatorModel;
  let qaModel = platform.models.qaModel;
  let modelSource: "platform_default" | "tenant_preset" | "tenant_explicit" | "tenant_rejected_not_allowed" =
    "platform_default";

  const parsed = parseAiMode(aiMode);

  const allowlist = getModelAllowlist();

  if (parsed.kind === "preset" && parsed.value) {
    const resolved = resolvePresetModels(parsed.value as any, platform.models.estimatorModel, platform.models.qaModel);
    estimatorModel = resolved.estimatorModel;
    qaModel = resolved.qaModel;
    modelSource = "tenant_preset";
  }

  if (parsed.kind === "explicit" && parsed.value) {
    const desired = String(parsed.value).trim();
    if (isAllowedModel(desired, allowlist)) {
      // Use same model for estimator + QA unless you want to split later.
      estimatorModel = desired;
      qaModel = desired;
      modelSource = "tenant_explicit";
    } else {
      modelSource = "tenant_rejected_not_allowed";
      // keep platform defaults
    }
  }

  return {
    platform,
    models: {
      estimatorModel,
      qaModel,
      renderModel: platform.models.renderModel,
    },
    prompts: platform.prompts,
    guardrails: platform.guardrails,
    tenant: {
      aiMode,
      renderingStyle,
      renderingNotes,
      renderingCustomerOptInRequired,
      tenantRenderEnabled,
    },
    meta: { modelSource },
  };
}