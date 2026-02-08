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

  // what Step3 uses today
  selectedKey: string | null;
  selectedLabel?: string | null;

  // platform industries
  industries: IndustryItem[];

  // ✅ NEW (additive; safe for existing callers)
  // AI hint (ensured in industries table, but still helpful to show "suggested")
  suggestedKey?: string | null;

  // tenant-scoped sub-industries
  subIndustries?: SubIndustryItem[];

  // AI hint for sub-industry label (do NOT assume it's already created)
  suggestedSubIndustryLabel?: string | null;

  error?: string;
  message?: string;
};