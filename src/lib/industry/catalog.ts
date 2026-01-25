// src/lib/industry/catalog.ts

export type SubIndustry = {
  key: string;   // stable identifier (snake_case)
  label: string; // UI label
};

export type IndustryCatalog = Record<string, SubIndustry[]>;

/**
 * Platform defaults (expand anytime).
 * Key = tenant_settings.industry_key
 */
export const PLATFORM_SUB_INDUSTRIES: IndustryCatalog = {
  upholstery: [
    { key: "auto", label: "Auto" },
    { key: "marine", label: "Marine" },
    { key: "motorcycle", label: "Motorcycle" },
    { key: "rv", label: "RV" },
    { key: "commercial", label: "Commercial" },
  ],
  landscaping: [
    { key: "residential", label: "Residential" },
    { key: "commercial", label: "Commercial" },
    { key: "hoa", label: "HOA / Community" },
    { key: "hardscape", label: "Hardscape" },
    { key: "maintenance", label: "Maintenance" },
  ],
};

/**
 * If we don't recognize an industry yet, we still offer useful choices.
 * This keeps scale sane for unknown industries.
 */
export const GENERIC_SUB_INDUSTRIES: SubIndustry[] = [
  { key: "residential", label: "Residential" },
  { key: "commercial", label: "Commercial" },
  { key: "emergency", label: "Emergency / Rush" },
  { key: "maintenance", label: "Maintenance" },
  { key: "new_install", label: "New Install" },
];

/** Normalize a user-provided key into safe snake_case-ish */
export function normalizeKey(input: string) {
  const s = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s;
}

/** Merge platform defaults + tenant custom list (dedupe by key) */
export function mergeSubIndustries(industryKey: string | null | undefined, tenantCustom: SubIndustry[]) {
  const k = String(industryKey ?? "").trim().toLowerCase();
  const platform = PLATFORM_SUB_INDUSTRIES[k] ?? GENERIC_SUB_INDUSTRIES;

  const byKey = new Map<string, SubIndustry>();
  for (const x of platform) byKey.set(x.key, x);
  for (const x of tenantCustom || []) {
    if (!x?.key) continue;
    byKey.set(x.key, { key: x.key, label: x.label || x.key });
  }

  return Array.from(byKey.values());
}