// src/lib/pcc/llm/store.ts
import { z } from "zod";
import {
  type PlatformLlmConfig,
  defaultPlatformLlmConfig,
} from "@/lib/pcc/llm/types";

const EnvKey = "PCC_LLM_CONFIG_JSON";

// ---- schema (runtime validation) ----
const LlmModelConfigSchema = z.object({
  estimatorModel: z.string().min(1),
  qaModel: z.string().min(1),
  renderModel: z.string().min(1).optional(),
});

const LlmPromptSetSchema = z.object({
  quoteEstimatorSystem: z.string().min(1),
  qaQuestionGeneratorSystem: z.string().min(1),
  extraSystemPreamble: z.string().optional(),
});

const LlmGuardrailsSchema = z.object({
  blockedTopics: z.array(z.string().min(1)).default([]),
  maxQaQuestions: z.number().int().min(1).max(10).default(3),
  maxOutputTokens: z.number().int().min(100).max(4000).optional(),
});

const PlatformLlmConfigSchema = z.object({
  version: z.number().int().min(1).default(1),
  models: LlmModelConfigSchema,
  prompts: LlmPromptSetSchema,
  guardrails: LlmGuardrailsSchema,
  updatedAt: z.string().min(1),
});

// ---- helpers ----
function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function mergeDefaults(base: PlatformLlmConfig, override: Partial<PlatformLlmConfig>): PlatformLlmConfig {
  // shallow-ish merge to keep v1 simple (no fancy patch semantics)
  const merged: PlatformLlmConfig = {
    ...base,
    ...override,
    models: { ...base.models, ...(override.models ?? {}) },
    prompts: { ...base.prompts, ...(override.prompts ?? {}) },
    guardrails: { ...base.guardrails, ...(override.guardrails ?? {}) },
    updatedAt: override.updatedAt ?? base.updatedAt,
  };

  // guardrails sanity
  merged.guardrails.maxQaQuestions = Math.max(1, Math.min(10, Number(merged.guardrails.maxQaQuestions ?? 3)));

  return merged;
}

// ---- public API ----

/**
 * Load platform LLM config (V1).
 * Source priority:
 *  1) env PCC_LLM_CONFIG_JSON
 *  2) defaults (in code)
 */
export async function loadPlatformLlmConfig(): Promise<PlatformLlmConfig> {
  const defaults = defaultPlatformLlmConfig();

  const raw = process.env[EnvKey]?.trim();
  if (!raw) return defaults;

  const parsed = safeJsonParse(raw);
  if (!parsed || typeof parsed !== "object") return defaults;

  const safe = PlatformLlmConfigSchema.safeParse(parsed);
  if (!safe.success) {
    // If env is malformed, do not break runtime — fall back to defaults.
    return defaults;
  }

  // Merge in case env omitted new fields
  return mergeDefaults(defaults, safe.data as any);
}

/**
 * Validate a config payload from the PCC UI.
 * Returns a fully-normalized config that can be serialized.
 */
export function validateAndNormalizePlatformLlmConfig(input: unknown): PlatformLlmConfig {
  const defaults = defaultPlatformLlmConfig();

  const safe = PlatformLlmConfigSchema.safeParse(input);
  if (!safe.success) {
    // throw a friendly error for API/UI
    const msg = safe.error.issues?.[0]?.message ?? "Invalid LLM config";
    throw new Error(msg);
  }

  const normalized = mergeDefaults(defaults, safe.data as any);

  // always bump updatedAt if caller didn't
  if (!normalized.updatedAt) normalized.updatedAt = new Date().toISOString();

  return normalized;
}

/**
 * Serialize config to a JSON string suitable for env storage or later DB storage.
 */
export function serializePlatformLlmConfig(cfg: PlatformLlmConfig): string {
  return JSON.stringify(cfg);
}