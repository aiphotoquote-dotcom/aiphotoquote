// src/lib/pricing/formatEstimate.ts

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

function coerceMode(p: PricingPolicySnapshot): AiMode {
  if (!p.pricing_enabled) return "assessment_only";
  if (p.ai_mode === "fixed") return "fixed";
  if (p.ai_mode === "range") return "range";
  return "assessment_only";
}

function formatUSD(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function formatEstimateForPolicy(args: {
  policy: any;
  estLow: any;
  estHigh: any;
}): { mode: AiMode; moneyLine: string | null; label: string } {
  const policy = normalizePricingPolicy(args.policy);
  const mode = coerceMode(policy);

  const low = Number(args.estLow);
  const high = Number(args.estHigh);
  const lowOk = Number.isFinite(low) ? low : null;
  const highOk = Number.isFinite(high) ? high : null;

  if (mode === "assessment_only") {
    return { mode, moneyLine: null, label: "Assessment only" };
  }

  if (mode === "fixed") {
    const one = lowOk != null ? lowOk : highOk != null ? highOk : null;
    return { mode, moneyLine: one != null ? formatUSD(one) : null, label: "Estimate" };
  }

  // range
  if (lowOk != null && highOk != null) return { mode, moneyLine: `${formatUSD(lowOk)} – ${formatUSD(highOk)}`, label: "Estimate range" };
  if (lowOk != null) return { mode, moneyLine: formatUSD(lowOk), label: "Estimate range" };
  if (highOk != null) return { mode, moneyLine: formatUSD(highOk), label: "Estimate range" };
  return { mode, moneyLine: null, label: "Estimate range" };
}