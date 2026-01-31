// src/components/pcc/llm/helpers/preview.ts

export function promptPreview(s: string, max = 220) {
  const t = String(s ?? "");
  if (t.length <= max) return t;
  return t.slice(0, max) + "…";
}