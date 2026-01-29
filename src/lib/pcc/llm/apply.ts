// src/lib/pcc/llm/apply.ts
import { loadPlatformLlmConfig } from "./store";
import type { PlatformLlmConfig } from "./types";

/**
 * Central “resolver” so routes stop hardcoding models/prompts.
 * Routes can call:
 *   const llm = await getPlatformLlm();
 *   llm.models.estimatorModel
 *   llm.prompts.quoteEstimatorSystem
 */
export async function getPlatformLlm(): Promise<{
  cfg: PlatformLlmConfig;
  models: {
    estimatorModel: string;
    qaModel: string;
    renderPromptModel: string;
  };
  prompts: {
    quoteEstimatorSystem: string;
    qaQuestionGeneratorSystem: string;
  };
  guardrails: {
    mode: "strict" | "balanced" | "permissive";
    blockedTopics: string[];
    piiHandling: "redact" | "allow" | "deny";
    maxOutputTokens: number;
  };
}> {
  const cfg = await loadPlatformLlmConfig();

  // Defensive normalization (don’t trust storage blindly)
  const estimatorModel = String(cfg.models?.estimatorModel || "gpt-4o-mini").trim() || "gpt-4o-mini";
  const qaModel = String(cfg.models?.qaModel || "gpt-4o-mini").trim() || "gpt-4o-mini";
  const renderPromptModel = String(cfg.models?.renderPromptModel || "gpt-4o-mini").trim() || "gpt-4o-mini";

  const quoteEstimatorSystem = String(cfg.promptSets?.quoteEstimatorSystem || "").trim();
  const qaQuestionGeneratorSystem = String(cfg.promptSets?.qaQuestionGeneratorSystem || "").trim();

  const maxOutputTokensRaw = Number(cfg.guardrails?.maxOutputTokens ?? 900);
  const maxOutputTokens = Number.isFinite(maxOutputTokensRaw)
    ? Math.max(200, Math.min(4000, Math.floor(maxOutputTokensRaw)))
    : 900;

  const modeRaw = String(cfg.guardrails?.mode ?? "balanced");
  const mode = (modeRaw === "strict" || modeRaw === "balanced" || modeRaw === "permissive"
    ? modeRaw
    : "balanced") as "strict" | "balanced" | "permissive";

  const piiRaw = String(cfg.guardrails?.piiHandling ?? "redact");
  const piiHandling = (piiRaw === "redact" || piiRaw === "allow" || piiRaw === "deny" ? piiRaw : "redact") as
    | "redact"
    | "allow"
    | "deny";

  const blockedTopics = Array.isArray(cfg.guardrails?.blockedTopics)
    ? cfg.guardrails.blockedTopics.map((s) => String(s)).filter(Boolean)
    : [];

  return {
    cfg,
    models: { estimatorModel, qaModel, renderPromptModel },
    prompts: {
      quoteEstimatorSystem:
        quoteEstimatorSystem ||
        [
          "You are an expert estimator for service work based on photos and customer notes.",
          "Be conservative: return a realistic RANGE, not a single number.",
          "If photos are insufficient or ambiguous, set confidence low and inspection_required true.",
          "Do not invent brand/model/year—ask questions instead.",
          "Return ONLY valid JSON matching the schema provided by the server.",
        ].join("\n"),
      qaQuestionGeneratorSystem:
        qaQuestionGeneratorSystem ||
        [
          "You generate short, practical clarification questions for a service quote based on photos and notes.",
          "Ask only what is necessary to estimate accurately.",
          "Return ONLY valid JSON: { questions: string[] }",
        ].join("\n"),
    },
    guardrails: {
      mode,
      blockedTopics,
      piiHandling,
      maxOutputTokens,
    },
  };
}

/**
 * Optional helper: quick safety “pre-filter” for text you might echo back.
 * This is not a full safety system—just a cheap guard based on PCC settings.
 */
export function applyBasicTextGuardrails(input: string, cfg: { piiHandling: "redact" | "allow" | "deny" }) {
  const s = String(input ?? "");
  if (cfg.piiHandling === "allow") return s;

  // very basic email/phone redaction (good enough for UI / logs)
  const redacted = s
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/(\+?1[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, "[redacted-phone]");

  if (cfg.piiHandling === "deny") {
    // If it *looks* like we found PII, drop it.
    if (redacted !== s) return "";
  }

  return redacted;
}