// src/lib/llm/compose.ts

import type { PlatformLlmConfig } from "@/lib/pcc/llm/types";
import { resolvePromptsForIndustry } from "@/lib/pcc/llm/resolvePrompts";
import type { PricingPolicySnapshot } from "./types";

function safeTrim(v: unknown) {
  return String(v ?? "").trim();
}

function withPreamble(preamble: string, system: string) {
  const s = safeTrim(system);
  const p = safeTrim(preamble);
  if (!p) return s;
  if (!s) return p;
  return `${p}\n\n${s}`;
}

function isAiMode(v: string): v is PricingPolicySnapshot["ai_mode"] {
  return v === "assessment_only" || v === "range" || v === "fixed";
}

function normalizePricingPolicy(pp: PricingPolicySnapshot): PricingPolicySnapshot {
  if (!pp.pricing_enabled) {
    return { ai_mode: "assessment_only", pricing_enabled: false, pricing_model: null };
  }
  const ai_mode = isAiMode(pp.ai_mode as any) ? (pp.ai_mode as any) : "range";
  return { ai_mode, pricing_enabled: true, pricing_model: (pp.pricing_model as any) ?? null };
}

function wrapEstimatorSystemWithPricingPolicy(baseSystem: string, policy: PricingPolicySnapshot) {
  const p = normalizePricingPolicy(policy);
  const { ai_mode, pricing_enabled, pricing_model } = p;

  const policyBlock = [
    "### POLICY (must follow exactly)",
    "- You are generating a photo-based quote response in a fixed JSON schema.",
    pricing_enabled
      ? "- Pricing is ENABLED."
      : "- Pricing is DISABLED. Do not output any price numbers. Set estimate_low=0 and estimate_high=0.",
    ai_mode === "assessment_only"
      ? "- AI mode is ASSESSMENT ONLY. Do not output any price numbers. Set estimate_low=0 and estimate_high=0."
      : ai_mode === "fixed"
        ? "- AI mode is FIXED ESTIMATE. Output a single-number estimate by setting estimate_low == estimate_high."
        : "- AI mode is RANGE. Output a low/high range.",
    "- If you are unsure, prefer inspection_required=true and keep estimates conservative.",
    "",
  ].join("\n");

  if (!pricing_enabled) return `${policyBlock}\n${baseSystem}`;

  const modelHint =
    pricing_model === "flat_per_job"
      ? "Pricing methodology hint: think a single job total."
      : pricing_model === "hourly_plus_materials"
        ? "Pricing methodology hint: think hours and material costs/markup."
        : pricing_model === "per_unit"
          ? "Pricing methodology hint: estimate per-unit and multiply."
          : pricing_model === "packages"
            ? "Pricing methodology hint: think Basic/Standard/Premium tiers."
            : pricing_model === "line_items"
              ? "Pricing methodology hint: think add-ons; base service + optional items."
              : pricing_model === "inspection_only"
                ? "Pricing methodology hint: prefer inspection_required=true."
                : pricing_model === "assessment_fee"
                  ? "Pricing methodology hint: assessment/diagnostic fee model."
                  : "";

  return [policyBlock, modelHint ? `### PRICING MODEL NOTES\n${modelHint}\n` : "", baseSystem].join("\n");
}

/**
 * Compose prompts using 3 layers:
 * 1) Platform base prompt(s)
 * 2) Industry prompt pack override (only if tenant hasn't overridden base)
 * 3) Pricing policy wrapper (estimator only; defense-in-depth)
 */
export function composePrompts(args: {
  platformCfg: PlatformLlmConfig;
  platformBase: {
    quoteEstimatorSystem: string;
    qaQuestionGeneratorSystem: string;
  };
  tenantResolved: {
    quoteEstimatorSystem: string;
    qaQuestionGeneratorSystem: string;
  };
  industryKey: string;
  pricingPolicy: PricingPolicySnapshot;
}) {
  const { platformCfg, platformBase, tenantResolved, industryKey, pricingPolicy } = args;

  const basePack = resolvePromptsForIndustry(platformCfg, industryKey);

  const baseExtra = safeTrim(basePack.extraSystemPreamble);
  const packEstimator = withPreamble(baseExtra, safeTrim(basePack.quoteEstimatorSystem));
  const packQa = withPreamble(baseExtra, safeTrim(basePack.qaQuestionGeneratorSystem));

  const isUsingBaseEstimator = safeTrim(tenantResolved.quoteEstimatorSystem) === safeTrim(platformBase.quoteEstimatorSystem);
  const isUsingBaseQa = safeTrim(tenantResolved.qaQuestionGeneratorSystem) === safeTrim(platformBase.qaQuestionGeneratorSystem);

  const effectiveEstimatorBase =
    isUsingBaseEstimator && safeTrim(packEstimator) ? packEstimator : safeTrim(tenantResolved.quoteEstimatorSystem);

  const effectiveQaBase = isUsingBaseQa && safeTrim(packQa) ? packQa : safeTrim(tenantResolved.qaQuestionGeneratorSystem);

  const estimatorWithPolicy = wrapEstimatorSystemWithPricingPolicy(effectiveEstimatorBase, pricingPolicy);

  return {
    quoteEstimatorSystem: estimatorWithPolicy,
    qaQuestionGeneratorSystem: effectiveQaBase,
    meta: {
      industryPromptPackApplied: {
        industryKey,
        estimatorApplied: Boolean(isUsingBaseEstimator && safeTrim(packEstimator)),
        qaApplied: Boolean(isUsingBaseQa && safeTrim(packQa)),
      },
    },
  };
}