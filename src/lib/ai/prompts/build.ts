// src/lib/ai/prompts/build.ts
import { getIndustryPromptConfig, type PromptBuildInput } from "./catalog";

function normKey(v: string | null | undefined) {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function buildEstimatePrompt(args: PromptBuildInput & { categoryLabel?: string | null }) {
  const industryKey = normKey(args.industryKey) || "service";
  const subKey = normKey(args.subIndustryKey);

  const cfg = getIndustryPromptConfig(industryKey);

  const system = cfg.estimateSystem.join("\n");

  const headerLines: string[] = [];
  headerLines.push(`Industry: ${industryKey || "service"}`);
  if (subKey) headerLines.push(`Sub-industry: ${subKey}`);
  if (args.serviceType) headerLines.push(`Service type: ${String(args.serviceType).trim()}`);
  headerLines.push(`Customer notes: ${args.notes?.trim() ? args.notes.trim() : "(none)"}`);

  const userText = [
    ...headerLines,
    "",
    ...cfg.estimateUserGuidance,
  ].join("\n");

  return { system, userText, industryKey, subIndustryKey: subKey || null };
}

export function buildRenderPrompt(args: PromptBuildInput) {
  const industryKey = normKey(args.industryKey) || "service";
  const subKey = normKey(args.subIndustryKey);

  const cfg = getIndustryPromptConfig(industryKey);

  const parts: string[] = [];
  parts.push(...cfg.renderBase);

  if (subKey && cfg.renderSubIndustry?.[subKey]) {
    parts.push(...cfg.renderSubIndustry[subKey]);
  }

  // IMPORTANT: we want the render route to be able to reuse this exact prompt.
  // Keep it stable, deterministic, and tenant-auditable.
  parts.push(`Industry: ${industryKey}.`);
  if (subKey) parts.push(`Sub-industry: ${subKey}.`);
  if (args.serviceType) parts.push(`Service type hint: ${String(args.serviceType).trim()}.`);
  if (args.notes?.trim()) parts.push(`Customer intent/notes: ${args.notes.trim()}.`);

  // Keep it short enough to be useful and consistent.
  return parts.join(" ");
}