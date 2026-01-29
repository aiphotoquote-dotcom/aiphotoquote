// src/lib/pcc/llm/apply.ts
import { loadPlatformLlmConfig } from "./store";
import type { PlatformLlmConfig, GuardrailsMode, PiiHandling } from "./types";

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
    renderModel: string;
  };
  prompts: {
    quoteEstimatorSystem: string;
    qaQuestionGeneratorSystem: string;
  };
  guardrails: {
    mode: GuardrailsMode;
    blockedTopics: string[];
    piiHandling: PiiHandling;
    maxQaQuestions: number;
    maxOutputTokens: number;
  };
}> {
  const cfg = await loadPlatformLlmConfig();

  // -------- models --------
  const estimatorModel = String(cfg?.models?.estimatorModel ?? "gpt-4o-mini").trim() || "gpt-4o-mini";
  const qaModel = String(cfg?.models?.qaModel ?? "gpt-4o-mini").trim() || "gpt-4o-mini";

  // NOTE: stored config default might be "gpt-image-1" but we treat this as a string identifier.
  // This does NOT control image generation directly (that's handled elsewhere).
  const renderModel = String(cfg?.models?.renderModel ?? "gpt-image-1").trim() || "gpt-image-1";

  // -------- prompts --------
  const extraSystemPreamble = String(cfg?.prompts?.extraSystemPreamble ?? "").trim();

  const quoteEstimatorSystemBase = String(cfg?.prompts?.quoteEstimatorSystem ?? "").trim();
  const qaQuestionGeneratorSystemBase = String(cfg?.prompts?.qaQuestionGeneratorSystem ?? "").trim();

  const defaultQuoteEstimatorSystem = [
    "You are an expert estimator for service work based on photos and customer notes.",
    "Be conservative: return a realistic RANGE, not a single number.",
    "If photos are insufficient or ambiguous, set confidence low and inspection_required true.",
    "Do not invent brand/model/year—ask questions instead.",
    "Return ONLY valid JSON matching the schema provided by the server.",
  ].join("\n");

  const defaultQaQuestionGeneratorSystem = [
    "You generate short, practical clarification questions for a service quote based on photos and notes.",
    "Ask only what is necessary to estimate accurately.",
    "Return ONLY valid JSON: { questions: string[] }",
  ].join("\n");

  function withPreamble(preamble: string, system: string) {
    const s = String(system ?? "").trim();
    const p = String(preamble ?? "").trim();
    if (!p) return s;
    if (!s) return p;
    return `${p}\n\n${s}`;
  }

  const quoteEstimatorSystem = withPreamble(
    extraSystemPreamble,
    quoteEstimatorSystemBase || defaultQuoteEstimatorSystem
  );

  const qaQuestionGeneratorSystem = withPreamble(
    extraSystemPreamble,
    qaQuestionGeneratorSystemBase || defaultQaQuestionGeneratorSystem
  );

  // -------- guardrails --------
  const maxOutputTokensRaw = Number(cfg?.guardrails?.maxOutputTokens ?? 1200);
  const maxOutputTokens = Number.isFinite(maxOutputTokensRaw)
    ? Math.max(200, Math.min(4000, Math.floor(maxOutputTokensRaw)))
    : 1200;

  const maxQaQuestionsRaw = Number(cfg?.guardrails?.maxQaQuestions ?? 3);
  const maxQaQuestions = Number.isFinite(maxQaQuestionsRaw)
    ? Math.max(1, Math.min(10, Math.floor(maxQaQuestionsRaw)))
    : 3;

  const modeRaw = String((cfg?.guardrails as any)?.mode ?? "balanced");
  const mode: GuardrailsMode =
    modeRaw === "strict" || modeRaw === "balanced" || modeRaw === "permissive" ? modeRaw : "balanced";

  const piiRaw = String((cfg?.guardrails as any)?.piiHandling ?? "redact");
  const piiHandling: PiiHandling = piiRaw === "redact" || piiRaw === "allow" || piiRaw === "deny" ? piiRaw : "redact";

  const blockedTopics = Array.isArray(cfg?.guardrails?.blockedTopics)
    ? cfg.guardrails.blockedTopics.map((s) => String(s).trim()).filter(Boolean)
    : [];

  return {
    cfg,
    models: { estimatorModel, qaModel, renderModel },
    prompts: {
      quoteEstimatorSystem,
      qaQuestionGeneratorSystem,
    },
    guardrails: {
      mode,
      blockedTopics,
      piiHandling,
      maxQaQuestions,
      maxOutputTokens,
    },
  };
}

/**
 * Optional helper: quick safety “pre-filter” for text you might echo back.
 * This is not a full safety system—just a cheap guard based on PCC settings.
 */
export function applyBasicTextGuardrails(input: string, cfg: { piiHandling: PiiHandling }) {
  const s = String(input ?? "");
  if (cfg.piiHandling === "allow") return s;

  // very basic email/phone redaction (good enough for UI / logs)
  const redacted = s
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/(\+?1[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, "[redacted-phone]");

  if (cfg.piiHandling === "deny") {
    if (redacted !== s) return "";
  }

  return redacted;
}