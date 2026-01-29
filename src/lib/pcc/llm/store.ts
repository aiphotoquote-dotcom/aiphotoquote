// src/lib/pcc/llm/store.ts
import { put, head, del } from "@vercel/blob";

export type PlatformLlmConfig = {
  version: number;

  models: {
    estimatorModel: string;
    qaModel: string;
    renderModel?: string;
  };

  prompts: {
    quoteEstimatorSystem: string;
    qaQuestionGeneratorSystem: string;
    extraSystemPreamble?: string;
  };

  guardrails: {
    blockedTopics: string[];
    maxQaQuestions: number;
    maxOutputTokens?: number;
  };

  updatedAt: string;
};

const BLOB_KEY = "pcc/llm/platform-llm-config.json";

function nowIso() {
  return new Date().toISOString();
}

function defaultConfig(): PlatformLlmConfig {
  return {
    version: 1,
    models: {
      estimatorModel: "gpt-4o-mini",
      qaModel: "gpt-4o-mini",
      renderModel: "gpt-image-1",
    },
    prompts: {
      extraSystemPreamble: [
        "You are producing an estimate for legitimate service work.",
        "Do not provide instructions for wrongdoing or unsafe activity.",
        "Do not request or expose sensitive personal data beyond what is needed for the quote.",
        "If the submission is ambiguous, ask clarifying questions instead of guessing.",
      ].join("\n"),
      qaQuestionGeneratorSystem: [
        "You generate short, practical clarification questions for a service quote based on photos and notes.",
        "Ask only what is necessary to estimate accurately.",
        "Keep each question to one sentence.",
        "Prefer measurable details (dimensions, quantity, material, access, location).",
        "Avoid questions the photo obviously answers.",
        "Return ONLY valid JSON: { questions: string[] }",
      ].join("\n"),
      quoteEstimatorSystem: [
        "You are an expert estimator for service work based on photos and customer notes.",
        "Be conservative: return a realistic RANGE, not a single number.",
        "If photos are insufficient or ambiguous, set confidence low and inspection_required true.",
        "Do not invent brand/model/year—ask questions instead.",
        "Return ONLY valid JSON matching the provided schema.",
      ].join("\n"),
    },
    guardrails: {
      blockedTopics: [
        "credit card",
        "social security",
        "ssn",
        "password",
        "explosive",
        "bomb",
        "weapon",
      ],
      maxQaQuestions: 3,
      maxOutputTokens: 1200,
    },
    updatedAt: nowIso(),
  };
}

function safeParse(json: string | null): PlatformLlmConfig | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as PlatformLlmConfig;
  } catch {
    return null;
  }
}

async function getBlobUrlIfExists(): Promise<string | null> {
  try {
    const meta = await head(BLOB_KEY);
    return meta?.url ?? null;
  } catch {
    return null;
  }
}

export async function loadPlatformLlmConfig(): Promise<PlatformLlmConfig> {
  // Try env override first (fast, deploy-friendly)
  const envRaw = process.env.PCC_LLM_CONFIG?.trim();
  const envCfg = safeParse(envRaw || null);
  if (envCfg) return envCfg;

  // Then blob (persistent)
  const url = await getBlobUrlIfExists();
  if (url) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      const txt = await res.text();
      const cfg = safeParse(txt);
      if (cfg) return cfg;
    } catch {
      // fallthrough
    }
  }

  // Default
  return defaultConfig();
}

export async function savePlatformLlmConfig(cfg: PlatformLlmConfig): Promise<void> {
  const payload = JSON.stringify(cfg, null, 2);
  // Overwrite by using same key (Vercel Blob will version internally; URL changes)
  await put(BLOB_KEY, payload, {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
  });
}

/**
 * Optional: reset to defaults by deleting blob (won't affect env override).
 */
export async function resetPlatformLlmConfig(): Promise<void> {
  try {
    await del(BLOB_KEY);
  } catch {
    // ignore
  }
}