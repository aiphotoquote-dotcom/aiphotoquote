// src/lib/llm/types.ts

import type OpenAI from "openai";

export type KeySource = "tenant" | "platform_grace";

export type AiMode = "assessment_only" | "range" | "fixed";

export type PricingModel =
  | "flat_per_job"
  | "hourly_plus_materials"
  | "per_unit"
  | "packages"
  | "line_items"
  | "inspection_only"
  | "assessment_fee";

export type PricingPolicySnapshot = {
  ai_mode: AiMode;
  pricing_enabled: boolean;
  pricing_model: PricingModel | null;
};

export type DebugFn = (stage: string, data?: Record<string, any>) => void;

export type LlmContext = {
  openai: OpenAI;
  keySource: KeySource;

  models: {
    estimatorModel: string;
    qaModel: string;
    renderModel: string;
  };

  guardrails: {
    mode: string;
    blockedTopics: string[];
    piiHandling: string;
    maxQaQuestions: number;
    maxOutputTokens: number;
  };

  prompts: {
    quoteEstimatorSystem: string;
    qaQuestionGeneratorSystem: string;
  };

  meta: {
    compositionVersion: number;
    industryKeyApplied: string;
    industryPromptPackApplied: {
      industryKey: string;
      estimatorApplied: boolean;
      qaApplied: boolean;
    };
  };

  tenant: {
    liveQaEnabled: boolean;
    liveQaMaxQuestions: number;
    tenantRenderEnabled: boolean;
    pricingEnabled: boolean;

    tenantStyleKey: string | null;
    tenantRenderNotes: string | null;
  };

  pricingPolicy: PricingPolicySnapshot;

  generateQaQuestions(args: {
    images: Array<{ url: string; shotType?: string }>;
    category: string;
    service_type: string;
    notes: string;
    maxQuestions: number;
    debug?: DebugFn;
  }): Promise<string[]>;

  generateEstimate(args: {
    images: Array<{ url: string; shotType?: string }>;
    category: string;
    service_type: string;
    notes: string;
    normalizedAnswers?: Array<{ question: string; answer: string }>;
    debug?: DebugFn;
  }): Promise<{
    confidence: "high" | "medium" | "low";
    inspection_required: boolean;
    estimate_low: number;
    estimate_high: number;
    currency: string;
    summary: string;
    visible_scope: string[];
    assumptions: string[];
    questions: string[];
    _raw?: string;
  }>;
};