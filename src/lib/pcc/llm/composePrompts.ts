// src/lib/pcc/llm/composePrompts.ts
import type { PlatformLlmConfig } from "./types";
import type { PricingPolicySnapshot } from "@/lib/pricing/computeEstimate";

type ComposeArgs = {
  platform: {
    prompts: {
      quoteEstimatorSystem: string;
      qaQuestionGeneratorSystem: string;
      extraSystemPreamble?: string;
      industryPromptPacks?: any;
    };
    guardrails: {
      blockedTopics: string[];
      maxQaQuestions: number;
    };
  };

  tenant: {
    tenantStyleKey?: string | null;
    tenantRenderNotes?: string | null;
    pricingEnabled: boolean;
  };

  industryKey: string | null;
  pricingPolicy: PricingPolicySnapshot;
};

function safe(v: unknown) {
  return String(v ?? "").trim();
}

function buildGuardrailBlock(blockedTopics: string[]) {
  const lines = [
    "### PLATFORM GUARDRAILS (NON-NEGOTIABLE)",
    "- Output MUST be valid JSON and MUST match the server-provided JSON schema exactly.",
    "- Do not fabricate unseen details from photos; if unsure, say so via assumptions/questions.",
    "- If photos/notes are ambiguous, set confidence lower and set inspection_required=true.",
  ];

  if (blockedTopics?.length) {
    lines.push(`- Never discuss or process these topics: ${blockedTopics.join(", ")}.`);
  }

  return lines.join("\n");
}

/**
 * Improve "estimator voice" while keeping schema unchanged:
 * - summary: 2–4 sentences, plain English, like a real estimator note
 * - keep lists short, specific, and non-generic
 */
function buildEstimatorStyleBlock(policy: PricingPolicySnapshot) {
  const p = policy;
  const pricingEnabled = Boolean(p?.pricing_enabled);
  const aiMode = safe((p as any)?.ai_mode) || "assessment_only";

  const modeLine =
    !pricingEnabled || aiMode === "assessment_only"
      ? "- Pricing is disabled/assessment-only: summary should explain why a site visit is needed; do not include any pricing language."
      : aiMode === "fixed"
        ? "- Pricing mode is FIXED: summary should explain the single-number estimate and the main cost drivers."
        : "- Pricing mode is RANGE: summary should explain why the estimate is a range and the key drivers between low/high.";

  const lines = [
    "### ESTIMATOR COMMUNICATION STYLE (IMPORTANT)",
    "- Write like a seasoned estimator writing notes for a customer + internal lead.",
    "- Avoid generic filler. Be concrete about what you see and what drives cost.",
    "- summary must be 2–4 sentences, plain English, no bullet points in summary.",
    modeLine,
    "- visible_scope: 3–6 short scope bullets max. Make them specific to THIS job; avoid repeating the prompt.",
    "- assumptions: 3–5 items max. Phrase as true estimator assumptions (e.g., access, disposal, material grade, dimensions not shown).",
    "- questions: 3–5 items max. Ask only what changes price or feasibility.",
    "- If inspection_required=true, summary should clearly state what needs to be verified onsite and why.",
  ];

  return lines.join("\n");
}

function buildPricingBlock(policy: PricingPolicySnapshot) {
  const { pricing_enabled, ai_mode, pricing_model } = policy;

  const lines = ["### PRICING POLICY (HARD RULES)"];

  if (!pricing_enabled || ai_mode === "assessment_only") {
    lines.push(
      "- Pricing is disabled or assessment-only.",
      "- Set estimate_low = 0 and estimate_high = 0.",
      "- Do NOT output monetary values."
    );
  } else if (ai_mode === "fixed") {
    lines.push("- Pricing mode is FIXED.", "- Set estimate_low == estimate_high.");
  } else {
    lines.push("- Pricing mode is RANGE.");
  }

  if (pricing_enabled && pricing_model) {
    lines.push(`- Pricing model hint: ${pricing_model}.`);
  }

  return lines.join("\n");
}

function buildIndustryLayer(cfg: PlatformLlmConfig, industryKey: string | null, which: "estimator" | "qa") {
  const key = safe(industryKey);
  if (!key) return "";

  const pack = (cfg as any)?.prompts?.industryPromptPacks?.[key];
  if (!pack) return "";

  const fragments =
    which === "estimator"
      ? [pack.extraSystemPreamble, pack.quoteEstimatorSystem]
      : [pack.extraSystemPreamble, pack.qaQuestionGeneratorSystem];

  const cleaned = fragments.map(safe).filter(Boolean);
  if (!cleaned.length) return "";

  return ["### INDUSTRY SPECIALIZATION", ...cleaned].join("\n\n");
}

function buildTenantLayer(tenant: ComposeArgs["tenant"]) {
  const fragments: string[] = [];

  if (safe(tenant.tenantStyleKey)) {
    fragments.push(`Tenant style preference: ${safe(tenant.tenantStyleKey)}.`);
  }

  if (safe(tenant.tenantRenderNotes)) {
    fragments.push(`Tenant-specific notes: ${safe(tenant.tenantRenderNotes)}.`);
  }

  if (!fragments.length) return "";

  return ["### TENANT CONTEXT", ...fragments].join("\n\n");
}

export function composeEstimatorPrompt(args: ComposeArgs) {
  const { platform, tenant, industryKey, pricingPolicy } = args;

  const parts = [
    buildGuardrailBlock(platform.guardrails.blockedTopics),
    safe(platform.prompts.extraSystemPreamble),
    safe(platform.prompts.quoteEstimatorSystem),
    buildIndustryLayer(platform as any, industryKey, "estimator"),
    buildTenantLayer(tenant),
    buildEstimatorStyleBlock(pricingPolicy),
    buildPricingBlock(pricingPolicy),
  ]
    .map(safe)
    .filter(Boolean);

  return parts.join("\n\n");
}

export function composeQaPrompt(args: ComposeArgs) {
  const { platform, tenant, industryKey, pricingPolicy } = args;

  // For QA we still want concise + practical (and cap question count)
  const qaStyle = [
    "### Q&A QUESTION STYLE",
    "- Ask short, practical clarification questions only.",
    "- Do not ask more than the server cap.",
    "- Avoid generic questions; ask only what affects scope, materials, dimensions, access, or pricing certainty.",
    "- Return ONLY valid JSON: { questions: string[] }",
  ].join("\n");

  const parts = [
    buildGuardrailBlock(platform.guardrails.blockedTopics),
    safe(platform.prompts.extraSystemPreamble),
    safe(platform.prompts.qaQuestionGeneratorSystem),
    buildIndustryLayer(platform as any, industryKey, "qa"),
    buildTenantLayer(tenant),
    qaStyle,
    // keep pricing policy available to QA (some modes should steer questions)
    buildPricingBlock(pricingPolicy),
  ]
    .map(safe)
    .filter(Boolean);

  return parts.join("\n\n");
}