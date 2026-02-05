// src/lib/pcc/llm/types.ts

export type GuardrailsMode = "strict" | "balanced" | "permissive";
export type PiiHandling = "redact" | "allow" | "deny";

export type PlatformLlmConfig = {
  version: number;

  models: {
    // Used for onboarding website analysis (/api/onboarding/*)
    onboardingModel?: string;

    // Used for estimate + QA in /api/quote/submit
    estimatorModel: string;
    qaModel: string;

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

    // used by /api/quote/render
    renderPromptPreamble?: string;

    // template used by /api/quote/render
    // Supports placeholders:
    // {renderPromptPreamble} {style} {serviceTypeLine} {summaryLine} {customerNotesLine} {tenantRenderNotesLine}
    renderPromptTemplate?: string;

    // PCC-owned style preset text; tenant selects key via ai-policy (photoreal/clean_oem/custom)
    renderStylePresets?: {
      photoreal?: string;
      clean_oem?: string;
      custom?: string;
    };
  };

  guardrails: {
    mode?: GuardrailsMode;
    piiHandling?: PiiHandling;

    blockedTopics: string[];

    maxQaQuestions: number;

    maxOutputTokens?: number;
  };

  updatedAt: string;
};

export function defaultPlatformLlmConfig(): PlatformLlmConfig {
  return {
    version: 1,
    models: {
      // ✅ default onboarding model (can be overridden in PCC UI later)
      onboardingModel: "gpt-4.1",

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