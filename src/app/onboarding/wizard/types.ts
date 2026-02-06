export type Mode = "new" | "update" | "existing";

export type OnboardingState = {
  ok: boolean;
  isAuthenticated?: boolean;
  tenantId: string | null;
  tenantName: string | null;
  currentStep: number;
  completed: boolean;
  website: string | null;
  aiAnalysis: any | null;

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

export type IndustriesResponse = {
  ok: boolean;
  tenantId: string;
  selectedKey: string | null;
  industries: IndustryItem[];
  error?: string;
  message?: string;
};