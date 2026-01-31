// src/components/pcc/llm/helpers/modelOptions.ts

export type ModelOption = { value: string; label: string };

export const TEXT_MODEL_OPTIONS: ModelOption[] = [
  { value: "gpt-4o", label: "gpt-4o (best quality)" },
  { value: "gpt-4o-mini", label: "gpt-4o-mini (fast/cheap)" },
  { value: "gpt-4.1", label: "gpt-4.1" },
  { value: "gpt-4.1-mini", label: "gpt-4.1-mini" },
  { value: "custom", label: "Custom…" },
];

// Render model (image generation)
export const IMAGE_MODEL_OPTIONS: ModelOption[] = [
  { value: "gpt-image-1", label: "gpt-image-1 (recommended)" },
  // keep an escape hatch for anything new/experimental
  { value: "custom", label: "Custom…" },
];