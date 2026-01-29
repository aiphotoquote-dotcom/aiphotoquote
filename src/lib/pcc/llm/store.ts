// src/lib/pcc/llm/store.ts
import { put } from "@vercel/blob";
import { PlatformLlmConfig, defaultPlatformLlmConfig } from "./types";

function safeJsonParse(text: string): any | null {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function isObject(x: any): x is Record<string, any> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

export function validatePlatformLlmConfig(x: any): { ok: true; value: PlatformLlmConfig } | { ok: false; error: string } {
  if (!isObject(x)) return { ok: false, error: "Config must be a JSON object." };
  if (typeof x.version !== "number") return { ok: false, error: "Missing/invalid 'version' (number)." };
  if (typeof x.updatedAt !== "string") return { ok: false, error: "Missing/invalid 'updatedAt' (string)." };

  if (!isObject(x.guardrails)) return { ok: false, error: "Missing/invalid 'guardrails' object." };
  if (!["strict", "balanced", "permissive"].includes(String(x.guardrails.mode)))
    return { ok: false, error: "guardrails.mode must be strict|balanced|permissive." };
  if (!Array.isArray(x.guardrails.blockedTopics)) return { ok: false, error: "guardrails.blockedTopics must be string[]." };
  if (!["redact", "allow", "deny"].includes(String(x.guardrails.piiHandling)))
    return { ok: false, error: "guardrails.piiHandling must be redact|allow|deny." };
  if (typeof x.guardrails.maxOutputTokens !== "number")
    return { ok: false, error: "guardrails.maxOutputTokens must be a number." };

  if (!isObject(x.models)) return { ok: false, error: "Missing/invalid 'models' object." };
  for (const k of ["estimatorModel", "qaModel", "renderPromptModel"]) {
    if (typeof x.models[k] !== "string" || !String(x.models[k]).trim()) {
      return { ok: false, error: `models.${k} must be a non-empty string.` };
    }
  }

  if (!isObject(x.promptSets)) return { ok: false, error: "Missing/invalid 'promptSets' object." };
  for (const k of ["quoteEstimatorSystem", "qaQuestionGeneratorSystem"]) {
    if (typeof x.promptSets[k] !== "string" || !String(x.promptSets[k]).trim()) {
      return { ok: false, error: `promptSets.${k} must be a non-empty string.` };
    }
  }

  // normalize updatedAt to ISO
  const updatedAt = new Date(x.updatedAt);
  const normalized: PlatformLlmConfig = {
    version: Number(x.version),
    updatedAt: isNaN(updatedAt.getTime()) ? new Date().toISOString() : updatedAt.toISOString(),
    guardrails: {
      mode: x.guardrails.mode,
      blockedTopics: x.guardrails.blockedTopics.map((s: any) => String(s)).filter(Boolean),
      piiHandling: x.guardrails.piiHandling,
      maxOutputTokens: Number(x.guardrails.maxOutputTokens),
    },
    models: {
      estimatorModel: String(x.models.estimatorModel),
      qaModel: String(x.models.qaModel),
      renderPromptModel: String(x.models.renderPromptModel),
    },
    promptSets: {
      quoteEstimatorSystem: String(x.promptSets.quoteEstimatorSystem),
      qaQuestionGeneratorSystem: String(x.promptSets.qaQuestionGeneratorSystem),
    },
  };

  return { ok: true, value: normalized };
}

/**
 * V1 persistence:
 * - If PLATFORM_LLM_CONFIG_URL is set, load from there.
 * - Else: return a default config.
 */
export async function loadPlatformLlmConfig(): Promise<PlatformLlmConfig> {
  const url = (process.env.PLATFORM_LLM_CONFIG_URL || "").trim();
  if (!url) return defaultPlatformLlmConfig();

  try {
    const res = await fetch(url, { cache: "no-store" });
    const txt = await res.text();
    const parsed = safeJsonParse(txt);
    const v = validatePlatformLlmConfig(parsed);
    if (v.ok) return v.value;
    return defaultPlatformLlmConfig();
  } catch {
    return defaultPlatformLlmConfig();
  }
}

/**
 * Writes a new config JSON blob and returns the public URL.
 * NOTE: You can paste that URL into PLATFORM_LLM_CONFIG_URL to make it canonical.
 */
export async function savePlatformLlmConfig(cfg: PlatformLlmConfig): Promise<{ url: string }> {
  const payload: PlatformLlmConfig = { ...cfg, updatedAt: new Date().toISOString() };

  const key = `pcc/platform-llm-config-v${payload.version}-${Date.now()}.json`;
  const blob = await put(key, JSON.stringify(payload, null, 2), {
    access: "public",
    contentType: "application/json",
  });

  if (!blob?.url) throw new Error("Blob write failed (no url).");
  return { url: blob.url };
}