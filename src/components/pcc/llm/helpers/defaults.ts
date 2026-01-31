// src/components/pcc/llm/helpers/defaults.ts

export type RenderStyleKey = "photoreal" | "clean_oem" | "custom";

export function defaultRenderPromptPreamble() {
  return [
    "You are generating a safe, non-violent, non-sexual concept render for legitimate service work.",
    "Do NOT add text, watermarks, logos, brand marks, or UI overlays.",
    "No nudity, no explicit content, no weapons, no illegal activity.",
  ].join("\n");
}

export function defaultRenderPromptTemplate() {
  return [
    "{renderPromptPreamble}",
    "Generate a realistic 'after' concept rendering based on the customer's photos.",
    "Do NOT add text or watermarks.",
    "Style: {style}",
    "{serviceTypeLine}",
    "{summaryLine}",
    "{customerNotesLine}",
    "{tenantRenderNotesLine}",
  ].join("\n");
}

export function defaultStylePreset(key: RenderStyleKey) {
  if (key === "clean_oem") return "clean OEM refresh, factory-correct look, neutral lighting, product photo feel";
  if (key === "custom") return "custom show-style upgrade, premium materials, dramatic but tasteful lighting";
  return "photorealistic, clean lighting, product photography feel";
}