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
    "- You must follow the server-provided JSON schema exactly.",
    "- Do not fabricate unseen details.",
    "- If uncertain, lower confidence and require inspection.",
  ];

  if (blockedTopics?.length) {
    lines.push(
      `- Never discuss or process these topics: ${blockedTopics.join(", ")}.`
    );
  }

  return lines.join("\n");
}

function buildPricingBlock(policy: PricingPolicySnapshot) {
  const { pricing_enabled, ai_mode, pricing_model } = policy;

  const lines = [
    "### PRICING POLICY (HARD RULES)",
  ];

  if (!pricing_enabled || ai_mode === "assessment_only") {
    lines.push(
      "- Pricing is disabled or assessment-only.",
      "- Set estimate_low = 0 and estimate_high = 0.",
      "- Do NOT output monetary values."
    );
  } else if (ai_mode === "fixed") {
    lines.push(
      "- Pricing mode is FIXED.",
      "- Set estimate_low == estimate_high."
    );
  } else {
    lines.push("- Pricing mode is RANGE.");
  }

  if (pricing_enabled && pricing_model) {
    lines.push(`- Pricing model hint: ${pricing_model}.`);
  }

  return lines.join("\n");
}

function buildIndustryLayer(cfg: PlatformLlmConfig, industryKey: string | null) {
  const key = safe(industryKey);
  if (!key) return "";

  const pack = cfg.prompts?.industryPromptPacks?.[key];
  if (!pack) return "";

  const fragments = [
    pack.extraSystemPreamble,
    pack.quoteEstimatorSystem,
  ]
    .map(safe)
    .filter(Boolean);

  if (!fragments.length) return "";

  return ["### INDUSTRY SPECIALIZATION", ...fragments].join("\n\n");
}

function buildTenantLayer(tenant: ComposeArgs["tenant"]) {
  const fragments: string[] = [];

  if (safe(tenant.tenantStyleKey)) {
    fragments.push(`Tenant style preference: ${tenant.tenantStyleKey}.`);
  }

  if (safe(tenant.tenantRenderNotes)) {
    fragments.push(`Tenant-specific notes: ${tenant.tenantRenderNotes}.`);
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
    buildIndustryLayer(platform as any, industryKey),
    buildTenantLayer(tenant),
    buildPricingBlock(pricingPolicy),
  ]
    .map(safe)
    .filter(Boolean);

  return parts.join("\n\n");
}

export function composeQaPrompt(args: ComposeArgs) {
  const { platform, tenant, industryKey } = args;

  const parts = [
    buildGuardrailBlock(platform.guardrails.blockedTopics),
    safe(platform.prompts.extraSystemPreamble),
    safe(platform.prompts.qaQuestionGeneratorSystem),
    buildIndustryLayer(platform as any, industryKey),
    buildTenantLayer(tenant),
  ]
    .map(safe)
    .filter(Boolean);

  return parts.join("\n\n");
}