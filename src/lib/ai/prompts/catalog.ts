// src/lib/ai/prompts/catalog.ts

export type PromptBuildInput = {
  industryKey: string;           // tenant_settings.industry_key
  subIndustryKey?: string | null; // e.g. "marine", "commercial"
  serviceType?: string | null;    // e.g. "upholstery", "mowing", etc (optional hint)
  notes?: string | null;
};

export type IndustryPromptConfig = {
  key: string;

  // Estimation (vision) prompt fragments
  estimateSystem: string[];
  estimateUserGuidance: string[];

  // Rendering prompt fragments (for image generation route)
  renderBase: string[];
  renderSubIndustry?: Record<string, string[]>; // optional modifiers per sub-industry key
};

const baseEstimateSystem: string[] = [
  "You are an expert estimator for service work based on photos and customer notes.",
  "Be conservative: return a realistic RANGE, not a single number.",
  "If photos are insufficient or ambiguous, set confidence low and inspection_required true.",
  "Do not invent brand/model/year—ask questions instead.",
  "Return ONLY valid JSON matching the provided schema.",
];

const baseEstimateGuidance: string[] = [
  "Instructions:",
  "- Use the photos to identify the item/material and visible damage/wear.",
  "- Provide estimate_low and estimate_high (whole dollars).",
  "- Provide visible_scope as short bullet-style strings.",
  "- Provide assumptions and questions (3–8 items each is fine).",
];

const upholstery: IndustryPromptConfig = {
  key: "upholstery",
  estimateSystem: [
    ...baseEstimateSystem,
    "You specialize in upholstery jobs (auto/marine/motorcycle/RV/commercial seating).",
    "Consider labor for removal/reinstall, patterning, foam repair, seams, and hardware.",
    "If marine context is likely, account for UV/mildew resistance and marine-grade materials.",
  ],
  estimateUserGuidance: [
    ...baseEstimateGuidance,
    "- Identify likely material (vinyl/leather/marine vinyl/cloth) and condition (UV cracking, tears, seam failure).",
    "- Ask for dimensions, number of panels/cushions, and whether foam is reusable if unclear.",
  ],
  renderBase: [
    "Photorealistic finished-result rendering of the item shown in the provided customer photos.",
    "Maintain the same item geometry and camera angle as the input photos as closely as possible.",
    "Show clean, professional upholstery work with realistic stitching and tension.",
    "Natural lighting, high detail, no text, no watermarks.",
  ],
  renderSubIndustry: {
    marine: [
      "Use marine-grade vinyl appearance with subtle texture and UV-safe finish.",
      "Environment may include a boat cockpit context (optional, subtle, not distracting).",
    ],
    auto: [
      "Use automotive upholstery look, tight fitment, premium finish.",
      "If seat panels are visible, show consistent panel alignment and stitching.",
    ],
    motorcycle: [
      "Motorcycle seat finish: durable vinyl/leather look, tight contours.",
      "Emphasize clean edges and consistent seam lines.",
    ],
    rv: [
      "RV upholstery finish: durable fabric/vinyl with clean lines and comfortable padding look.",
    ],
    commercial: [
      "Commercial seating finish: durable, clean, easy-to-maintain surface with professional look.",
    ],
  },
};

const landscaping: IndustryPromptConfig = {
  key: "landscaping",
  estimateSystem: [
    ...baseEstimateSystem,
    "You specialize in landscaping and outdoor property services.",
    "Consider access, disposal, property constraints, and seasonal factors.",
  ],
  estimateUserGuidance: [
    ...baseEstimateGuidance,
    "- Identify the service category (mowing, clean-up, mulch, hardscape, pruning, etc.).",
    "- Ask for lot size, scope boundaries, and whether disposal/haul-away is required.",
  ],
  renderBase: [
    "Photorealistic finished-result rendering of the outdoor area shown in the provided customer photos.",
    "Maintain the same camera angle and property layout as closely as possible.",
    "Show clean, professional landscaping results with realistic plants/materials.",
    "Natural lighting, high detail, no text, no watermarks.",
  ],
  renderSubIndustry: {
    residential: [
      "Residential look: inviting, tidy, curb-appeal oriented finishes.",
    ],
    commercial: [
      "Commercial look: neat, uniform, low-maintenance professional appearance.",
    ],
  },
};

const generic: IndustryPromptConfig = {
  key: "service",
  estimateSystem: baseEstimateSystem,
  estimateUserGuidance: baseEstimateGuidance,
  renderBase: [
    "Photorealistic finished-result rendering of the item/area shown in the provided customer photos.",
    "Maintain the same geometry and camera angle as closely as possible.",
    "High detail, realistic materials, natural lighting, no text, no watermarks.",
  ],
};

export const PROMPT_CATALOG: Record<string, IndustryPromptConfig> = {
  upholstery,
  landscaping,
  service: generic,
};

export function getIndustryPromptConfig(industryKey: string | null | undefined): IndustryPromptConfig {
  const k = String(industryKey ?? "").trim().toLowerCase();
  return PROMPT_CATALOG[k] ?? PROMPT_CATALOG.service;
}