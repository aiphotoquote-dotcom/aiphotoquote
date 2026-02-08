// src/app/onboarding/wizard/types.ts

export type Mode = "new" | "update" | "existing";

// UI plan tiers
export type PlanTier = "tier0" | "tier1" | "tier2";

export type OnboardingState = {
  ok: boolean;
  isAuthenticated?: boolean;
  tenantId: string | null;
  tenantName: string | null;
  currentStep: number;
  completed: boolean;
  website: string | null;
  aiAnalysis: any | null;

  // ✅ added
  planTier?: PlanTier | null;

  aiAnalysisStatus?: string | null;
  aiAnalysisRound?: number | null;
  aiAnalysisLastAction?: string | null;
  aiAnalysisError?: string | null;

  error?: string;
  message?: string;
};

export type IndustryItem = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  source: "platform" | "tenant";
};

export type SubIndustryItem = {
  id: string;
  key: string;
  label: string;
};

export type IndustriesResponse = {
  ok: boolean;
  tenantId: string;
  selectedKey: string | null;
  selectedLabel?: string | null;
  industries: IndustryItem[];

  // ✅ new additive fields from your updated API
  suggestedKey?: string | null;
  subIndustries?: SubIndustryItem[];
  suggestedSubIndustryLabel?: string | null;

  error?: string;
  message?: string;
};