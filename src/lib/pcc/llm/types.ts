// src/lib/pcc/llm/types.ts

export type GuardrailsMode = "strict" | "balanced" | "permissive";
export type PiiHandling = "redact" | "allow" | "deny";

export type IndustryPromptPack = {
  /**
   * Optional override preamble for this industry.
   * If omitted, platform prompts.extraSystemPreamble is used.
   */
  extraSystemPreamble?: string;

  /** Optional: estimator system prompt override (industry-specific tone + assumptions). */
  quoteEstimatorSystem?: string;

  /** Optional: QA generator system prompt override (industry-specific questions). */
  qaQuestionGeneratorSystem?: string;
};

export type PlatformLlmConfig = {
  version: number;

  models: {
    // Used for estimate + QA in /api/quote/submit
    estimatorModel: string;
    qaModel: string;

    // ✅ NEW: used for onboarding analysis (/api/onboarding/analyze-website)
    onboardingModel?: string;

    // Used for /api/quote/render (optional)
    renderModel?: string;
  };

  prompts: {
    // System prompt used for estimate generation
    quoteEstimatorSystem: string;

    // System prompt used for QA question generation
    qaQuestionGeneratorSystem: string;

    // Optional extra preamble prepended to BOTH system prompts
    extraSystemPreamble?: string;

    // ✅ NEW: used by /api/quote/render
    renderPromptPreamble?: string;

    // ✅ NEW: template used by /api/quote/render
    // Supports placeholders:
    // {renderPromptPreamble} {style} {serviceTypeLine} {summaryLine} {customerNotesLine} {tenantRenderNotesLine}
    renderPromptTemplate?: string;

    // ✅ NEW: PCC-owned style preset text; tenant selects key via ai-policy (photoreal/clean_oem/custom)
    renderStylePresets?: {
      photoreal?: string;
      clean_oem?: string;
      custom?: string;
    };

    /**
     * ✅ NEW: Industry prompt packs (platform-owned).
     * Keyed by industry_key (tenant_settings.industry_key), e.g.:
     * "marine_repair", "auto_upholstery", "general_contractor"
     */
    industryPromptPacks?: Record<string, IndustryPromptPack>;
  };

  guardrails: {
    // UI/API expects these (safe to default)
    mode?: GuardrailsMode;
    piiHandling?: PiiHandling;

    // Simple keyword/topic blocks (V1). We'll evolve this later.
    blockedTopics: string[];

    // Platform cap (tenant setting can be lower, not higher)
    maxQaQuestions: number;

    // Optional: keep around for future response_format/token tuning
    maxOutputTokens?: number;
  };

  updatedAt: string;
};

export function defaultPlatformLlmConfig(): PlatformLlmConfig {
  return {
    version: 1,
    models: {
      estimatorModel: "gpt-4o-mini",
      qaModel: "gpt-4o-mini",

      // ✅ default onboarding model (safe)
      onboardingModel: "gpt-4.1",

      // NOTE: this is just a stored value; image generation is separate.
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

      // ✅ NEW defaults for render prompting
      renderPromptPreamble: [
        "You are generating a safe, non-violent, non-sexual concept render for legitimate service work.",
        "Do NOT add text, watermarks, logos, brand marks, or UI overlays.",
        "No nudity, no explicit content, no weapons, no illegal activity.",
      ].join("\n"),

      renderStylePresets: {
        photoreal: "photorealistic, natural colors, clean lighting, product photography look, high detail",
        clean_oem:
          "clean OEM refresh, factory-correct look, subtle improvements, accurate seams, realistic materials, neutral lighting",
        custom:
          "custom show-style finish, premium materials, elevated stitching detail, tasteful upgrades, studio lighting, high detail",
      },

      renderPromptTemplate: [
        "{renderPromptPreamble}",
        "Generate a realistic 'after' concept rendering based on the customer's photos.",
        "Do NOT add text or watermarks.",
        "Style: {style}",
        "{serviceTypeLine}",
        "{summaryLine}",
        "{customerNotesLine}",
        "{tenantRenderNotesLine}",
      ].join("\n"),

      /**
       * ✅ Industry prompt packs start empty.
       * We'll add entries over time (PCC-managed).
       */
      industryPromptPacks: {
        // Example starter pack (optional):
        marine_repair: {
          quoteEstimatorSystem: [
            "You are an expert estimator for MARINE boat repair and restoration work.",
            "Be realistic about marine labor complexity and access constraints (marinas, lifts, haul-out).",
            "Assume corrosion, hidden damage, and prep time can be significant; reflect in range and assumptions.",
            "If the job involves fiberglass/gelcoat/paint: be explicit about prep steps and cure time.",
            "Return ONLY valid JSON matching the provided schema.",
          ].join("\n"),
          qaQuestionGeneratorSystem: [
            "You generate short clarification questions for a MARINE service quote based on photos and notes.",
            "Ask about boat length, location (in-water vs trailer), access to power, prior repairs, and finish expectations.",
            "Keep each question one sentence. Return ONLY valid JSON: { questions: string[] }",
          ].join("\n"),
        },
      },
    },
    guardrails: {
      mode: "balanced",
      piiHandling: "redact",
      blockedTopics: ["credit card", "social security", "ssn", "password", "explosive", "bomb", "weapon"],
      maxQaQuestions: 3,
      maxOutputTokens: 1200,
    },
    updatedAt: new Date().toISOString(),
  };
}