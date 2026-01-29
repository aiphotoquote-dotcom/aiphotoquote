// src/lib/pcc/llm/store.ts
import { PlatformLlmConfig } from "./types";

const DEFAULT_CFG: PlatformLlmConfig = {
  activePromptSetId: "default",
  promptSets: [
    {
      id: "default",
      name: "Default Prompt Set",
      description: "Baseline platform behavior",
      system:
        "You are AI Photo Quote. You produce safe, helpful, customer-friendly estimates. Follow platform guardrails.",
      developer:
        "Be concise. Ask clarifying questions only when necessary. Never reveal secrets. Be policy-compliant.",
      userTemplate: "{{USER_INPUT}}",
      model: "gpt-5",
      temperature: 0.2,
      guardrails: {
        style: "friendly",
        refuseOnPolicyViolation: true,
        requireCitations: false,
        enableImageRendering: true,
        enableLiveQa: true,
      },
      updatedAt: new Date().toISOString(),
    },
  ],
  defaultGuardrails: {
    style: "friendly",
    refuseOnPolicyViolation: true,
    enableImageRendering: true,
    enableLiveQa: true,
  },
  updatedAt: new Date().toISOString(),
};

// TEMP V1: memory store (per server instance). Replace with DB storage in PCC v1.1.
let memCfg: PlatformLlmConfig | null = null;

export async function loadPlatformLlmConfig(): Promise<PlatformLlmConfig> {
  // Optional: allow seeding via env var (JSON)
  const env = process.env.PCC_LLM_CONFIG_JSON;
  if (!memCfg) {
    if (env) {
      try {
        const parsed = JSON.parse(env);
        memCfg = sanitizeConfig(parsed);
      } catch {
        memCfg = DEFAULT_CFG;
      }
    } else {
      memCfg = DEFAULT_CFG;
    }
  }
  return memCfg;
}

export async function savePlatformLlmConfig(next: PlatformLlmConfig): Promise<void> {
  memCfg = sanitizeConfig(next);
}

function sanitizeConfig(input: any): PlatformLlmConfig {
  // Keep it strict-ish so bad edits don’t brick PCC
  const cfg: PlatformLlmConfig = {
    activePromptSetId: String(input?.activePromptSetId ?? "default"),
    promptSets: Array.isArray(input?.promptSets) ? input.promptSets.map(coercePromptSet) : DEFAULT_CFG.promptSets,
    defaultGuardrails: typeof input?.defaultGuardrails === "object" ? input.defaultGuardrails : DEFAULT_CFG.defaultGuardrails,
    updatedAt: new Date().toISOString(),
  };

  // ensure active exists
  if (!cfg.promptSets.some((p) => p.id === cfg.activePromptSetId)) {
    cfg.activePromptSetId = cfg.promptSets[0]?.id ?? "default";
  }
  return cfg;
}

function coercePromptSet(p: any) {
  return {
    id: String(p?.id ?? "default"),
    name: String(p?.name ?? "Prompt Set"),
    description: p?.description ? String(p.description) : undefined,
    system: String(p?.system ?? ""),
    developer: p?.developer ? String(p.developer) : undefined,
    userTemplate: p?.userTemplate ? String(p.userTemplate) : undefined,
    model: p?.model ? String(p.model) : "gpt-5",
    temperature: typeof p?.temperature === "number" ? p.temperature : 0.2,
    guardrails: typeof p?.guardrails === "object" ? p.guardrails : undefined,
    updatedAt: new Date().toISOString(),
  };
}