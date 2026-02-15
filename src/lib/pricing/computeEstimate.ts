// src/lib/pricing/computeEstimate.ts

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

export type PricingConfigSnapshot = {
  model: PricingModel | null;

  // flat
  flatRateDefault: number | null;

  // hourly + materials
  hourlyLaborRate: number | null;
  materialMarkupPercent: number | null;

  // per-unit
  perUnitRate: number | null;
  perUnitLabel: string | null;

  // packages / line items
  packageJson: any | null;
  lineItemsJson: any | null;

  // assessment fee
  assessmentFeeAmount: number | null;
  assessmentFeeCreditTowardJob: boolean | null;
};

export type PricingRulesSnapshot = {
  minJob: number | null;
  typicalLow: number | null;
  typicalHigh: number | null;
  maxWithoutInspection: number | null;

  tone?: string | null;
  riskPosture?: string | null; // "conservative" | "balanced" etc
  alwaysEstimateLanguage?: boolean | null;
};

export type AiEstimateLike = {
  confidence?: "high" | "medium" | "low" | string;
  inspection_required?: boolean;

  // These may exist from the model, but we will NOT trust them for pricing.
  estimate_low?: number;
  estimate_high?: number;

  visible_scope?: string[];
  assumptions?: string[];
  questions?: string[];
  summary?: string;
  currency?: string;
};

function clampInt(n: number, min: number, max: number) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function clampMoney(n: number) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, v);
}

function ensureLowHigh(low: number, high: number) {
  const a = clampMoney(low);
  const b = clampMoney(high);
  return a <= b ? { low: a, high: b } : { low: b, high: a };
}

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function normalizePolicy(p: PricingPolicySnapshot): PricingPolicySnapshot {
  const pricing_enabled = Boolean(p?.pricing_enabled);
  if (!pricing_enabled) return { ai_mode: "assessment_only", pricing_enabled: false, pricing_model: null };

  const ai_mode: AiMode = p.ai_mode === "range" || p.ai_mode === "fixed" || p.ai_mode === "assessment_only" ? p.ai_mode : "range";
  const pricing_model = p.pricing_model ?? null;
  return { ai_mode, pricing_enabled: true, pricing_model };
}

function confidenceWeight(conf: string) {
  const c = safeTrim(conf).toLowerCase();
  if (c === "high") return 0.85;
  if (c === "medium") return 1.0;
  return 1.2; // low/unknown => widen
}

function computeComplexityScore(ai: AiEstimateLike, imageCount: number) {
  const scopeCount = Array.isArray(ai.visible_scope) ? ai.visible_scope.filter(Boolean).length : 0;
  const qCount = Array.isArray(ai.questions) ? ai.questions.filter(Boolean).length : 0;
  const aCount = Array.isArray(ai.assumptions) ? ai.assumptions.filter(Boolean).length : 0;

  // Industry-agnostic proxy: more scope items/questions/assumptions/images => more complexity.
  const raw =
    1 +
    scopeCount * 0.9 +
    qCount * 0.35 +
    aCount * 0.2 +
    clampInt(imageCount, 1, 12) * 0.25 +
    (ai.inspection_required ? 1.0 : 0);

  // Clamp to a stable range so pricing doesn’t explode.
  return Math.max(1, Math.min(10, raw));
}

/**
 * Deterministic pricing:
 * - AI gives scope + inspection signal + confidence
 * - Server computes estimate using pricing config/rules
 *
 * NOTE:
 * - packages/line_items are intentionally not computed here yet (future expansion).
 * - If model is unsupported or config missing, we fall back to rules typicalLow/typicalHigh or 0.
 */
export function computeEstimate(args: {
  ai: AiEstimateLike;
  imagesCount: number;
  policy: PricingPolicySnapshot;
  config: PricingConfigSnapshot | null;
  rules: PricingRulesSnapshot | null;
}): { estimate_low: number; estimate_high: number; inspection_required: boolean; basis: any } {
  const { ai, imagesCount, policy, config, rules } = args;

  const p = normalizePolicy(policy);

  // Hard suppress:
  if (!p.pricing_enabled || p.ai_mode === "assessment_only") {
    return {
      estimate_low: 0,
      estimate_high: 0,
      inspection_required: Boolean(ai.inspection_required),
      basis: { method: "suppressed", reason: !p.pricing_enabled ? "pricing_disabled" : "assessment_only" },
    };
  }

  const model = (p.pricing_model || config?.model || null) as PricingModel | null;

  const minJob = rules?.minJob ?? null;
  const typicalLow = rules?.typicalLow ?? null;
  const typicalHigh = rules?.typicalHigh ?? null;
  const maxWithoutInspection = rules?.maxWithoutInspection ?? null;

  const confW = confidenceWeight(String(ai.confidence ?? "low"));
  const complexity = computeComplexityScore(ai, imagesCount);

  // Start with AI’s inspection signal, but allow rules to force.
  let inspection_required = Boolean(ai.inspection_required);

  let low = 0;
  let high = 0;
  let basis: any = { model, confW, complexity };

  const useTypicalFallback = () => {
    if (typeof typicalLow === "number" && typeof typicalHigh === "number") {
      const t = ensureLowHigh(typicalLow, typicalHigh);
      return { low: t.low, high: t.high, basis: { ...basis, method: "rules.typical" } };
    }
    if (typeof typicalLow === "number") {
      return { low: clampMoney(typicalLow), high: clampMoney(typicalLow), basis: { ...basis, method: "rules.typicalLowOnly" } };
    }
    return { low: 0, high: 0, basis: { ...basis, method: "fallback.zero" } };
  };

  if (model === "flat_per_job") {
    const base = config?.flatRateDefault ?? typicalLow ?? 0;
    const spread = base * (0.18 * confW) + complexity * 25; // deterministic widening
    low = Math.max(0, base - spread * 0.55);
    high = base + spread;

    basis = { ...basis, method: "flat_per_job", base, spread };
  } else if (model === "assessment_fee") {
    const fee = config?.assessmentFeeAmount ?? typicalLow ?? 0;
    low = fee;
    high = fee;
    basis = { ...basis, method: "assessment_fee", fee, creditTowardJob: Boolean(config?.assessmentFeeCreditTowardJob) };
  } else if (model === "hourly_plus_materials") {
    const hourly = config?.hourlyLaborRate ?? null;
    const markup = config?.materialMarkupPercent ?? 30;

    if (!hourly) {
      const t = useTypicalFallback();
      low = t.low;
      high = t.high;
      basis = t.basis;
    } else {
      // Hours derived deterministically from complexity + confidence.
      // (No industry hints; just scale a bounded score.)
      const baseHours = 2.5 + complexity * 0.85;
      const lowHours = Math.max(1, baseHours * 0.85);
      const highHours = baseHours * 1.25 * confW;

      const laborLow = lowHours * hourly;
      const laborHigh = highHours * hourly;

      // Materials: deterministic fraction of labor (bounded)
      const materialsLow = laborLow * 0.22;
      const materialsHigh = laborHigh * 0.35;

      const matLowWithMarkup = materialsLow * (1 + markup / 100);
      const matHighWithMarkup = materialsHigh * (1 + markup / 100);

      low = laborLow + matLowWithMarkup;
      high = laborHigh + matHighWithMarkup;

      basis = {
        ...basis,
        method: "hourly_plus_materials",
        hourly,
        markupPercent: markup,
        hours: { low: lowHours, high: highHours },
        labor: { low: laborLow, high: laborHigh },
        materials: { low: matLowWithMarkup, high: matHighWithMarkup },
      };
    }
  } else if (model === "per_unit") {
    const rate = config?.perUnitRate ?? null;
    const label = config?.perUnitLabel ?? null;

    if (!rate) {
      const t = useTypicalFallback();
      low = t.low;
      high = t.high;
      basis = t.basis;
    } else {
      // Units derived deterministically from complexity.
      const baseUnits = 4 + complexity * 3.2;
      const lowUnits = Math.max(1, baseUnits * 0.8);
      const highUnits = baseUnits * 1.35 * confW;

      low = lowUnits * rate;
      high = highUnits * rate;

      basis = {
        ...basis,
        method: "per_unit",
        perUnitRate: rate,
        perUnitLabel: label,
        units: { low: lowUnits, high: highUnits },
      };
    }
  } else if (model === "inspection_only") {
    // Do not pretend we can price: force inspection, suppress numbers unless typical range exists.
    inspection_required = true;
    const t = useTypicalFallback();
    low = t.low;
    high = t.high;
    basis = { ...t.basis, method: "inspection_only" };
  } else {
    // packages / line_items / null => fallback for now
    const t = useTypicalFallback();
    low = t.low;
    high = t.high;
    basis = { ...t.basis, method: model ? `unsupported.${model}` : "no_model" };
  }

  // Enforce min job
  if (typeof minJob === "number" && minJob > 0) {
    low = Math.max(low, minJob);
    high = Math.max(high, minJob);
    basis = { ...basis, minJobApplied: minJob };
  }

  // Enforce maxWithoutInspection: if quote exceeds max, force inspection + clamp high to max
  if (!inspection_required && typeof maxWithoutInspection === "number" && maxWithoutInspection > 0) {
    if (high > maxWithoutInspection) {
      inspection_required = true;
      high = maxWithoutInspection;
      low = Math.min(low, high);
      basis = { ...basis, maxWithoutInspectionApplied: maxWithoutInspection, forcedInspection: true };
    }
  }

  // Normalize low/high
  const norm = ensureLowHigh(low, high);
  low = norm.low;
  high = norm.high;

  // Apply ai_mode behavior
  if (p.ai_mode === "fixed") {
    const mid = clampMoney((low + high) / 2);
    low = mid;
    high = mid;
    basis = { ...basis, aiModeApplied: "fixed" };
  } else {
    basis = { ...basis, aiModeApplied: "range" };
  }

  return {
    estimate_low: clampMoney(low),
    estimate_high: clampMoney(high),
    inspection_required,
    basis,
  };
}