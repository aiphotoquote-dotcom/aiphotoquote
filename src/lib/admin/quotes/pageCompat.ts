// src/lib/admin/quotes/pageCompat.ts
export type { AdminReassessEngine, QuoteLogRow } from "@/lib/quotes/adminReassess";

export {
  normalizeEngine,
  normalizeAiMode,
  normalizePricingPolicy,
  formatEstimateForPolicy,
  normalizeStage,
  pickAiAssessmentFromAny,
  pickLead,
  pickCustomerNotes,
  pickPhotos,
  pickIndustryKeySnapshot,
  pickLlmKeySource,
} from "@/lib/admin/quotes/normalize";