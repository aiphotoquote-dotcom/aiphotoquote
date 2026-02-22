// src/lib/llm/context.ts

import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";
import { getPlatformLlm } from "@/lib/pcc/llm/apply";
import { resolveTenantLlm } from "@/lib/pcc/llm/resolveTenant";

import { composePrompts } from "./compose";
import { resolveOpenAiClient } from "./openaiClient";
import { runEstimate, runQaQuestions } from "./executor";

import type { DebugFn, KeySource, LlmContext, PricingPolicySnapshot } from "./types";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function clampMoney(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function ensureLowHigh(low: number, high: number) {
  const a = clampMoney(low);
  const b = clampMoney(high);
  return a <= b ? { low: a, high: b } : { low: b, high: a };
}

export async function buildLlmContext(args: {
  tenantId: string;
  industryKey: string;
  pricingPolicy: PricingPolicySnapshot;
  isPhase2: boolean;

  // phase2: force the same key source as the quote snapshot (if present)
  forceKeySource?: KeySource | null;

  debug?: DebugFn;
}): Promise<LlmContext> {
  const { tenantId, industryKey, pricingPolicy, isPhase2, forceKeySource, debug } = args;

  // Load platform + tenant resolved settings (toggles/models)
  const platformLlm = await getPlatformLlm(); // includes preamble application
  const platformCfg = await loadPlatformLlmConfig(); // needed for industry packs
  const tenantResolved = await resolveTenantLlm(tenantId);

  // Strict isolation: LLM layer owns the OpenAI client selection
  const { openai, keySource } = await resolveOpenAiClient({
    tenantId,
    consumeGrace: !isPhase2,
    forceKeySource: isPhase2 ? forceKeySource ?? null : null,
    debug,
  });

  // Compose system prompts from layers
  const composed = composePrompts({
    platformCfg,
    platformBase: platformLlm.prompts,
    tenantResolved: tenantResolved.prompts,
    industryKey,
    pricingPolicy,
  });

  const models = {
    estimatorModel: tenantResolved.models.estimatorModel,
    qaModel: tenantResolved.models.qaModel,
    renderModel: tenantResolved.models.renderModel,
  };

  const ctx: LlmContext = {
    openai,
    keySource,

    models,
    guardrails: tenantResolved.guardrails,

    prompts: {
      quoteEstimatorSystem: composed.quoteEstimatorSystem,
      qaQuestionGeneratorSystem: composed.qaQuestionGeneratorSystem,
    },

    meta: {
      compositionVersion: 1,
      industryKeyApplied: industryKey,
      industryPromptPackApplied: composed.meta.industryPromptPackApplied,
    },

    tenant: {
      liveQaEnabled: tenantResolved.tenant.liveQaEnabled,
      liveQaMaxQuestions: tenantResolved.tenant.liveQaMaxQuestions,
      tenantRenderEnabled: tenantResolved.tenant.tenantRenderEnabled,
      pricingEnabled: tenantResolved.tenant.pricingEnabled,

      tenantStyleKey: tenantResolved.tenant.tenantStyleKey ?? null,
      tenantRenderNotes: tenantResolved.tenant.tenantRenderNotes ?? null,
    },

    pricingPolicy,

    async generateQaQuestions(runArgs) {
      const userText = [
        `Category: ${runArgs.category}`,
        `Service type: ${runArgs.service_type}`,
        `Customer notes: ${runArgs.notes || "(none)"}`,
        "",
        `Generate up to ${runArgs.maxQuestions} questions.`,
      ].join("\n");

      return runQaQuestions({
        openai,
        model: models.qaModel,
        system: composed.qaQuestionGeneratorSystem,
        images: runArgs.images,
        userText,
        maxQuestions: runArgs.maxQuestions,
        debug: runArgs.debug,
      });
    },

    async generateEstimate(runArgs) {
      const qaText = runArgs.normalizedAnswers?.length
        ? runArgs.normalizedAnswers.map((x) => `Q: ${x.question}\nA: ${x.answer}`).join("\n\n")
        : "";

      const userText = [
        `Category: ${runArgs.category}`,
        `Service type: ${runArgs.service_type}`,
        `Customer notes: ${runArgs.notes || "(none)"}`,
        runArgs.normalizedAnswers?.length ? "Follow-up Q&A:" : "",
        runArgs.normalizedAnswers?.length ? (qaText || "(none)") : "",
        "",
        "Instructions:",
        "- Use the photos to identify the item, material type, and visible damage/wear.",
        "- Provide estimate_low and estimate_high (whole dollars).",
        "- Provide visible_scope as short bullet-style strings.",
        "- Provide assumptions and questions (3–8 items each is fine).",
      ]
        .filter((x) => x !== "")
        .join("\n");

      const r = await runEstimate({
        openai,
        model: models.estimatorModel,
        system: composed.quoteEstimatorSystem,
        images: runArgs.images,
        userText,
        debug: runArgs.debug,
      });

      const v = r.value;

      // Keep the same “ensureLowHigh” behavior you already had
      const { low, high } = ensureLowHigh(v.estimate_low, v.estimate_high);

      return {
        confidence: v.confidence,
        inspection_required: Boolean(v.inspection_required),
        estimate_low: low,
        estimate_high: high,
        currency: v.currency || "USD",
        summary: safeTrim(v.summary),
        visible_scope: Array.isArray(v.visible_scope) ? v.visible_scope : [],
        assumptions: Array.isArray(v.assumptions) ? v.assumptions : [],
        questions: Array.isArray(v.questions) ? v.questions : [],
        ...(r.ok ? {} : { _raw: (v as any)?._raw ?? undefined }),
      };
    },
  };

  debug?.("llm.context.built", {
    industryKey,
    compositionVersion: ctx.meta.compositionVersion,
    industryPromptPackApplied: ctx.meta.industryPromptPackApplied,
    keySource,
    models,
  });

  return ctx;
}