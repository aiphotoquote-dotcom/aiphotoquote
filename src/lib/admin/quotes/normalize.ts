// src/lib/admin/quotes/normalize.ts
import type { QuotePhoto } from "@/components/admin/QuotePhotoGallery";
import { digitsOnly, formatUSPhone, safeMoney, safeTrim, formatUSD } from "@/lib/admin/quotes/utils";

/* -------------------- lead / notes / photos -------------------- */
export function pickLead(input: any) {
  const c =
    input?.customer ??
    input?.contact ??
    input?.customer_context?.customer ??
    input?.customer_context ??
    input?.lead ??
    {};

  const name =
    c?.name ??
    c?.fullName ??
    c?.customerName ??
    input?.name ??
    input?.customer_context?.name ??
    "New customer";

  const phone =
    c?.phone ??
    c?.phoneNumber ??
    input?.phone ??
    input?.customer_context?.phone ??
    null;

  const email = c?.email ?? input?.email ?? input?.customer_context?.email ?? null;

  const phoneDigits = phone ? digitsOnly(String(phone)) : "";

  return {
    name: String(name || "New customer"),
    phone: phoneDigits ? formatUSPhone(phoneDigits) : null,
    phoneDigits: phoneDigits || null,
    email: email ? String(email) : null,
  };
}

export function pickCustomerNotes(input: any) {
  const notes =
    input?.customer_context?.notes ??
    input?.customer_context?.customer?.notes ??
    input?.notes ??
    input?.customerNotes ??
    input?.message ??
    null;

  const s = notes == null ? "" : String(notes).trim();
  return s || "";
}

export function pickPhotos(input: any): QuotePhoto[] {
  const out: QuotePhoto[] = [];

  const images = Array.isArray(input?.images) ? input.images : null;
  if (images) {
    for (const it of images) {
      const url = it?.url ?? it?.src ?? it?.href;
      if (url) out.push({ url: String(url), label: it?.shotType ?? it?.label ?? null });
    }
  }

  const photos = Array.isArray(input?.photos) ? input.photos : null;
  if (photos) {
    for (const it of photos) {
      const url = it?.url ?? it?.src ?? it?.href;
      if (url) out.push({ url: String(url), label: it?.label ?? null });
    }
  }

  const imageUrls = Array.isArray(input?.imageUrls) ? input.imageUrls : null;
  if (imageUrls) {
    for (const url of imageUrls) if (url) out.push({ url: String(url) });
  }

  const ccImages = Array.isArray(input?.customer_context?.images) ? input.customer_context.images : null;
  if (ccImages) {
    for (const it of ccImages) {
      const url = it?.url ?? it?.src ?? it?.href;
      if (url) out.push({ url: String(url), label: it?.label ?? null });
    }
  }

  const seen = new Set<string>();
  return out.filter((p) => {
    if (!p.url) return false;
    if (seen.has(p.url)) return false;
    seen.add(p.url);
    return true;
  });
}

/* -------------------- stages -------------------- */
export const STAGES = [
  { key: "new", label: "New" },
  { key: "estimate", label: "Estimate" },
  { key: "quoted", label: "Quoted" },
  { key: "contacted", label: "Contacted" },
  { key: "scheduled", label: "Scheduled" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "archived", label: "Archived" },
] as const;

export type StageKey = (typeof STAGES)[number]["key"];

export function normalizeStage(s: unknown): StageKey | "read" {
  const v = String(s ?? "").toLowerCase().trim();
  if (v === "read") return "read";
  const hit = STAGES.find((x) => x.key === v)?.key;
  return (hit ?? "new") as StageKey;
}

/* -------------------- ai output normalization -------------------- */
export function pickAiAssessmentFromAny(outAny: any) {
  const o = outAny ?? null;
  return o?.assessment ?? o?.output?.assessment ?? o?.output ?? o ?? null;
}

export function extractEstimate(outAny: any): { low: number | null; high: number | null } {
  const a = pickAiAssessmentFromAny(outAny);
  const low = safeMoney(a?.estimate_low ?? a?.estimateLow ?? a?.estimate?.low ?? a?.estimate?.estimate_low);
  const high = safeMoney(a?.estimate_high ?? a?.estimateHigh ?? a?.estimate?.high ?? a?.estimate?.estimate_high);
  return { low, high };
}

/* -------------------- pricing policy helpers (admin view) -------------------- */
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

export function normalizePricingPolicy(raw: any): PricingPolicySnapshot {
  const pricing_enabled = Boolean(raw?.pricing_enabled);

  const aiRaw = String(raw?.ai_mode ?? "").trim().toLowerCase();
  const ai_mode: AiMode =
    pricing_enabled && (aiRaw === "range" || aiRaw === "fixed" || aiRaw === "assessment_only")
      ? (aiRaw as AiMode)
      : pricing_enabled
        ? "range"
        : "assessment_only";

  const pmRaw = String(raw?.pricing_model ?? "").trim();
  const pricing_model: PricingModel | null =
    pricing_enabled &&
    (pmRaw === "flat_per_job" ||
      pmRaw === "hourly_plus_materials" ||
      pmRaw === "per_unit" ||
      pmRaw === "packages" ||
      pmRaw === "line_items" ||
      pmRaw === "inspection_only" ||
      pmRaw === "assessment_fee")
      ? (pmRaw as PricingModel)
      : null;

  if (!pricing_enabled) return { ai_mode: "assessment_only", pricing_enabled: false, pricing_model: null };
  return { ai_mode, pricing_enabled: true, pricing_model };
}

export function coerceMode(policy: PricingPolicySnapshot): AiMode {
  if (!policy.pricing_enabled) return "assessment_only";
  if (policy.ai_mode === "fixed") return "fixed";
  if (policy.ai_mode === "range") return "range";
  return "assessment_only";
}

export function formatEstimateForPolicy(args: {
  estLow: number | null;
  estHigh: number | null;
  policy: PricingPolicySnapshot;
}): { text: string | null; tone: "green" | "gray"; label: string } {
  const mode = coerceMode(args.policy);

  if (mode === "assessment_only") {
    return { text: null, tone: "gray", label: "Assessment only" };
  }

  const low = args.estLow;
  const high = args.estHigh;

  if (mode === "fixed") {
    const one = low != null ? low : high != null ? high : null;
    return { text: one != null ? formatUSD(one) : null, tone: "green", label: "Fixed estimate" };
  }

  // range
  if (low != null && high != null) {
    return { text: `${formatUSD(low)} – ${formatUSD(high)}`, tone: "green", label: "Range estimate" };
  }
  if (low != null) return { text: formatUSD(low), tone: "green", label: "Range estimate" };
  if (high != null) return { text: formatUSD(high), tone: "green", label: "Range estimate" };
  return { text: null, tone: "green", label: "Range estimate" };
}

/* -------------------- version creation UI helpers -------------------- */
export type EngineKey = "deterministic_pricing_only" | "full_ai_reassessment";

export function normalizeEngine(v: any): EngineKey {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "full_ai_reassessment" || s === "full" || s === "ai") return "full_ai_reassessment";
  return "deterministic_pricing_only";
}

export function normalizeAiMode(v: any): AiMode {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "fixed" || s === "range" || s === "assessment_only") return s as AiMode;
  return "assessment_only";
}

/* -------------------- misc pickers -------------------- */
export function pickIndustryKeySnapshot(inputAny: any) {
  return (
    safeTrim(inputAny?.industryKeySnapshot) ||
    safeTrim(inputAny?.industry_key_snapshot) ||
    safeTrim(inputAny?.customer_context?.category) ||
    null
  );
}

export function pickLlmKeySource(inputAny: any) {
  return safeTrim(inputAny?.llmKeySource) || null;
}