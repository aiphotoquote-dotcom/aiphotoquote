// src/lib/pricing/types.ts

export type PricingModel =
  | "flat_per_job"
  | "hourly_plus_materials"
  | "per_unit"
  | "packages"
  | "line_items"
  | "inspection_only"
  | "assessment_fee";

export type PricingConfig = {
  model: PricingModel | null;

  // flat
  flatRateDefault: number | null;

  // hourly + materials
  hourlyLaborRate: number | null;
  materialMarkupPercent: number | null;

  // per-unit
  perUnitRate: number | null;
  perUnitLabel: string | null;

  // packages / line items (structure validated elsewhere)
  packageJson: any | null;
  lineItemsJson: any | null;

  // assessment fee
  assessmentFeeAmount: number | null;
  assessmentFeeCreditTowardJob: boolean;
};

export type PricingPolicySnapshot = {
  ai_mode: "assessment_only" | "range" | "fixed";
  pricing_enabled: boolean;
  pricing_model: PricingModel | null;
};

export type PricingBreakdown = {
  model: PricingModel | null;
  currency: string;

  labor?: {
    hours_low: number;
    hours_high: number;
    rate: number;
    subtotal_low: number;
    subtotal_high: number;
  };

  materials?: {
    cost_low: number;
    cost_high: number;
    markup_percent: number;
    subtotal_low: number;
    subtotal_high: number;
  };

  per_unit?: {
    units_low: number;
    units_high: number;
    unit_rate: number;
    unit_label: string | null;
    subtotal_low: number;
    subtotal_high: number;
  };

  flat?: {
    subtotal_low: number;
    subtotal_high: number;
  };

  assessment_fee?: {
    fee: number;
    credit_toward_job: boolean;
  };

  // deterministic totals
  total_low: number;
  total_high: number;
};

export type AiComponents = {
  confidence: "high" | "medium" | "low";
  inspection_required: boolean;

  // Common narrative fields
  currency?: string;
  summary: string;
  visible_scope?: string[];
  assumptions?: string[];
  questions?: string[];

  // Components (not all models use all fields)
  labor_hours_low?: number;
  labor_hours_high?: number;

  materials_cost_low?: number;
  materials_cost_high?: number;

  units_low?: number;
  units_high?: number;

  // Optional single-number targets for some models
  flat_total_low?: number;
  flat_total_high?: number;
};