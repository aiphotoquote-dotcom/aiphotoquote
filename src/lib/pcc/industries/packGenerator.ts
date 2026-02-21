// src/lib/pcc/industries/packGenerator.ts
import crypto from "crypto";
import OpenAI from "openai";
import type { PlatformLlmConfig } from "@/lib/pcc/llm/types";

/**
 * Industry Pack Generator
 *
 * This module is PURE.
 * - No DB access
 * - No side effects
 * - No route logic
 *
 * It generates a Partial<PlatformLlmConfig>
 * that is safe to store in industry_llm_packs.pack
 *
 * Reusable by:
 * - onboarding
 * - PCC manual generate
 * - backfill job
 */

export type IndustryPackGenerationMode = "create" | "refine" | "backfill";

export type GenerateIndustryPackInput = {
  industryKey: string;
  industryLabel?: string | null;
  industryDescription?: string | null;

  exampleTenants?: Array<{
    name?: string;
    website?: string;
    summary?: string;
  }>;

  mode: IndustryPackGenerationMode;

  model?: string; // optional override
};

export type GenerateIndustryPackResult = {
  pack: Partial<PlatformLlmConfig>;
  meta: {
    model: string;
    mode: IndustryPackGenerationMode;
    inputHash: string;
    generatedAt: string;
  };
};

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function hashInput(obj: any) {
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

export async function generateIndustryPack(
  input: GenerateIndustryPackInput
): Promise<GenerateIndustryPackResult> {
  const industryKey = safeTrim(input.industryKey).toLowerCase();
  if (!industryKey) {
    throw new Error("INDUSTRY_KEY_REQUIRED");
  }

  const model = safeTrim(input.model) || "gpt-4.1";

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const contextSummary = {
    industryKey,
    industryLabel: safeTrim(input.industryLabel),
    industryDescription: safeTrim(input.industryDescription),
    exampleTenants: input.exampleTenants ?? [],
    mode: input.mode,
  };

  const inputHash = hashInput(contextSummary);

  const systemPrompt = `
You are generating an INDUSTRY PROMPT PACK for a multi-tenant AI quoting platform.

You must generate structured guidance for:

1) quoteEstimatorSystem
2) qaQuestionGeneratorSystem
3) renderPromptAddendum
4) renderNegativeGuidance

Rules:
- Be specific to the industry.
- Do NOT include pricing numbers.
- Focus on reasoning, constraints, realism, scope.
- Render guidance must describe visual outcomes and prevent off-topic drift.
- Return STRICT JSON only.
`;

  const userPrompt = `
Industry Key: ${industryKey}
Industry Label: ${safeTrim(input.industryLabel)}
Industry Description: ${safeTrim(input.industryDescription)}
Generation Mode: ${input.mode}

Example Tenants:
${JSON.stringify(input.exampleTenants ?? [], null, 2)}

Generate the industry pack.
Return JSON:
{
  "quoteEstimatorSystem": "...",
  "qaQuestionGeneratorSystem": "...",
  "renderPromptAddendum": "...",
  "renderNegativeGuidance": "..."
}
`;

  const resp = await openai.responses.create({
    model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const text = resp.output_text?.trim();
  if (!text) {
    throw new Error("LLM_EMPTY_RESPONSE");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("LLM_INVALID_JSON");
  }

  const pack: Partial<PlatformLlmConfig> = {
  prompts: ({
    industryPromptPacks: {
      [industryKey]: {
        quoteEstimatorSystem: parsed.quoteEstimatorSystem,
        qaQuestionGeneratorSystem: parsed.qaQuestionGeneratorSystem,
      },
    },
  } as Partial<PlatformLlmConfig["prompts"]>),
};

  // We store render guidance inside prompts for now
  // (keeps pack structure aligned with resolver expectations)
  (pack as any).renderPromptAddendum = parsed.renderPromptAddendum;
  (pack as any).renderNegativeGuidance = parsed.renderNegativeGuidance;

  return {
    pack,
    meta: {
      model,
      mode: input.mode,
      inputHash,
      generatedAt: new Date().toISOString(),
    },
  };
}