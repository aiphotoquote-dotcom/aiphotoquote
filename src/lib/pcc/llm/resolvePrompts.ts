// src/lib/pcc/llm/resolvePrompts.ts
import type { PlatformLlmConfig } from "./types";

export type ResolvedPrompts = {
  industryKey: string | null;
  extraSystemPreamble: string;
  quoteEstimatorSystem: string;
  qaQuestionGeneratorSystem: string;
};

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s;
}

export function resolvePromptsForIndustry(cfg: PlatformLlmConfig, industryKey: string | null | undefined): ResolvedPrompts {
  const key = safeTrim(industryKey) || null;

  const baseExtra = safeTrim(cfg.prompts.extraSystemPreamble);
  const baseEstimator = safeTrim(cfg.prompts.quoteEstimatorSystem);
  const baseQa = safeTrim(cfg.prompts.qaQuestionGeneratorSystem);

  const pack = key ? cfg.prompts.industryPromptPacks?.[key] : undefined;

  const extraSystemPreamble = safeTrim(pack?.extraSystemPreamble) || baseExtra;
  const quoteEstimatorSystem = safeTrim(pack?.quoteEstimatorSystem) || baseEstimator;
  const qaQuestionGeneratorSystem = safeTrim(pack?.qaQuestionGeneratorSystem) || baseQa;

  return {
    industryKey: key,
    extraSystemPreamble,
    quoteEstimatorSystem,
    qaQuestionGeneratorSystem,
  };
}