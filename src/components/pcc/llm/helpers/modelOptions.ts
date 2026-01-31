// src/components/pcc/llm/helpers/modelOptions.ts

export type ModelOption = { value: string; label: string };

export const TEXT_MODEL_OPTIONS: ModelOption[] = [
  { value: "gpt-4o", label: "gpt-4o (best quality)" },
  { value: "gpt-4o-mini", label: "gpt-4o-mini (fast/cheap)" },
  { value: "gpt-4.1", label: "gpt-4.1" },
  { value: "gpt-4.1-mini", label: "gpt-4.1-mini" },
  { value: "custom", label: "Custom…" },
];

// Image generation models (OpenAI Image API supports these)
// Docs: GPT Image models: gpt-image-1.5, gpt-image-1, gpt-image-1-mini
// Also supports dall-e-2 / dall-e-3 (deprecated; ends 05/12/2026)
export const IMAGE_MODEL_OPTIONS: ModelOption[] = [
  { value: "gpt-image-1.5", label: "gpt-image-1.5 (best quality)" },
  { value: "gpt-image-1", label: "gpt-image-1 (recommended)" },
  { value: "gpt-image-1-mini", label: "gpt-image-1-mini (cost-focused)" },

  // Optional legacy / deprecated (keep if you want the escape hatch visible)
  { value: "dall-e-3", label: "dall-e-3 (deprecated)" },
  { value: "dall-e-2", label: "dall-e-2 (deprecated)" },

  // keep an escape hatch for anything new/experimental
  { value: "custom", label: "Custom…" },
];