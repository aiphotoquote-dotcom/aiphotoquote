// src/lib/pricing/engine.ts
import type { AiComponents, PricingBreakdown, PricingConfig, PricingModel, PricingPolicySnapshot } from "./types";

function n(v: any, fallback = 0) {
  const x = typeof v === "string" ? Number(v) : Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function clampMoneyInt(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.round(v));
}

function ensureLowHigh(low: number, high: number) {
  const a = clampMoneyInt(low);
  const b = clampMoneyInt(high);
  return a <= b ? { low: a, high: b } : { low: b, high: a };
}

function clampNonNeg(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, v);
}

function normalizePolicy(p: PricingPolicySnapshot): PricingPolicySnapshot {
  if (!p?.pricing_enabled) return { ai_mode: "assessment_only", pricing_enabled: false, pricing_model: null };
  const mode = p.ai_mode === "fixed" || p.ai_mode === "range" ? p.ai_mode : "range";
  return { ai_mode: mode, pricing_enabled: true, pricing_model: p.pricing_model ?? null };
}

/**
 * Deterministic computation. No industry knowledge, ever.
 */
export function computeFromComponents(args: {
  policy: PricingPolicySnapshot;
  config: PricingConfig | null;
  components: AiComponents;
}): { estimate_low: number; estimate_high: number; breakdown: PricingBreakdown } {
  const policy = normalizePolicy(args.policy);
  const cfg = args.config;
  const c = args.components;

  const currency = String(c.currency || "USD").trim() || "USD";
  const model: PricingModel | null = policy.pricing_enabled ? (policy.pricing_model ?? cfg?.model ?? null) : null;

  // Hard suppression
  if (!policy.pricing_enabled || policy.ai_mode === "assessment_only") {
    return {
      estimate_low: 0,
      estimate_high: 0,
      breakdown: { model, currency, total_low: 0, total_high: 0 },
    };
  }

  // Compute per model
  let totalLow = 0;
  let totalHigh = 0;

  const breakdown: PricingBreakdown = { model, currency, total_low: 0, total_high: 0 };

  if (model === "hourly_plus_materials") {
    const rate = clampMoneyInt(n(cfg?.hourlyLaborRate, 0));
    const markup = clampNonNeg(n(cfg?.materialMarkupPercent, 0));

    const hoursLow = clampNonNeg(n(c.labor_hours_low, 0));
    const hoursHigh = clampNonNeg(n(c.labor_hours_high, hoursLow));

    const matLow = clampNonNeg(n(c.materials_cost_low, 0));
    const matHigh = clampNonNeg(n(c.materials_cost_high, matLow));

    const laborLow = clampMoneyInt(hoursLow * rate);
    const laborHigh = clampMoneyInt(hoursHigh * rate);

    const materialsLow = clampMoneyInt(matLow * (1 + markup / 100));
    const materialsHigh = clampMoneyInt(matHigh * (1 + markup / 100));

    totalLow = laborLow + materialsLow;
    totalHigh = laborHigh + materialsHigh;

    breakdown.labor = { hours_low: hoursLow, hours_high: hoursHigh, rate, subtotal_low: laborLow, subtotal_high: laborHigh };
    breakdown.materials = {
      cost_low: matLow,
      cost_high: matHigh,
      markup_percent: markup,
      subtotal_low: materialsLow,
      subtotal_high: materialsHigh,
    };
  } else if (model === "per_unit") {
    const unitRate = clampMoneyInt(n(cfg?.perUnitRate, 0));
    const unitsLow = clampNonNeg(n(c.units_low, 0));
    const unitsHigh = clampNonNeg(n(c.units_high, unitsLow));
    totalLow = clampMoneyInt(unitsLow * unitRate);
    totalHigh = clampMoneyInt(unitsHigh * unitRate);

    breakdown.per_unit = {
      units_low: unitsLow,
      units_high: unitsHigh,
      unit_rate: unitRate,
      unit_label: cfg?.perUnitLabel ?? null,
      subtotal_low: totalLow,
      subtotal_high: totalHigh,
    };
  } else if (model === "flat_per_job") {
    const dflt = clampMoneyInt(n(cfg?.flatRateDefault, 0));
    const lowRaw = n(c.flat_total_low, dflt);
    const highRaw = n(c.flat_total_high, lowRaw);
    const { low, high } = ensureLowHigh(lowRaw, highRaw);
    totalLow = low;
    totalHigh = high;

    breakdown.flat = { subtotal_low: totalLow, subtotal_high: totalHigh };
  } else if (model === "assessment_fee") {
    // This model still produces an estimate range for the job (if provided),
    // but also returns the fee in breakdown deterministically from config.
    const fee = clampMoneyInt(n(cfg?.assessmentFeeAmount, 0));
    breakdown.assessment_fee = { fee, credit_toward_job: Boolean(cfg?.assessmentFeeCreditTowardJob) };

    // If LLM provided a flat_total range, use it; else keep conservative zeros.
    const lowRaw = n(c.flat_total_low, 0);
    const highRaw = n(c.flat_total_high, lowRaw);
    const { low, high } = ensureLowHigh(lowRaw, highRaw);
    totalLow = low;
    totalHigh = high;
    breakdown.flat = { subtotal_low: totalLow, subtotal_high: totalHigh };
  } else if (model === "inspection_only") {
    // Deterministic: never show dollars (even though pricing is enabled)
    return {
      estimate_low: 0,
      estimate_high: 0,
      breakdown: { model, currency, total_low: 0, total_high: 0 },
    };
  } else {
    // Unknown / not implemented yet (packages, line_items):
    // safest behavior: suppress dollars but keep the policy “enabled”.
    return {
      estimate_low: 0,
      estimate_high: 0,
      breakdown: { model, currency, total_low: 0, total_high: 0 },
    };
  }

  // Apply ai_mode "fixed" collapse
  const { low, high } = ensureLowHigh(totalLow, totalHigh);
  if (policy.ai_mode === "fixed") {
    const mid = clampMoneyInt((low + high) / 2);
    breakdown.total_low = mid;
    breakdown.total_high = mid;
    return { estimate_low: mid, estimate_high: mid, breakdown };
  }

  breakdown.total_low = low;
  breakdown.total_high = high;
  return { estimate_low: low, estimate_high: high, breakdown };
}