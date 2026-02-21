// src/lib/pcc/industries/packGenerator.ts
import crypto from "crypto";
import OpenAI from "openai";
import type { PlatformLlmConfig } from "@/lib/pcc/llm/types";

/**
 * Industry Pack Generator
 *
 * This module is PURE.
 * - No DB access
 * - No side effects (other than calling the LLM)
 * - No route logic
 *
 * It generates a pack fragment that is safe to store in industry_llm_packs.pack
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

function requireString(name: string, v: any) {
  const s = safeTrim(v);
  if (!s) throw new Error(`LLM_MISSING_FIELD:${name}`);
  return s;
}

export async function generateIndustryPack(input: GenerateIndustryPackInput): Promise<GenerateIndustryPackResult> {
  const industryKey = safeTrim(input.industryKey).toLowerCase();
  if (!industryKey) throw new Error("INDUSTRY_KEY_REQUIRED");

  const model = safeTrim(input.model) || "gpt-4.1";

  const apiKey = safeTrim(process.env.OPENAI_API_KEY);
  if (!apiKey) throw new Error("OPENAI_API_KEY_MISSING");

  const openai = new OpenAI({ apiKey });

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
`.trim();

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
`.trim();

  const resp = await openai.responses.create({
    model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const text = resp.output_text?.trim();
  if (!text) throw new Error("LLM_EMPTY_RESPONSE");

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("LLM_INVALID_JSON");
  }

  // Validate required fields so we never persist empty packs
  const quoteEstimatorSystem = requireString("quoteEstimatorSystem", parsed?.quoteEstimatorSystem);
  const qaQuestionGeneratorSystem = requireString("qaQuestionGeneratorSystem", parsed?.qaQuestionGeneratorSystem);
  const renderPromptAddendum = requireString("renderPromptAddendum", parsed?.renderPromptAddendum);
  const renderNegativeGuidance = requireString("renderNegativeGuidance", parsed?.renderNegativeGuidance);

  /**
   * IMPORTANT:
   * Your runtime expects industry packs under:
   *   prompts.industryPromptPacks[industryKey].*
   *
   * And your PlatformLlmConfig typing has required top-level prompts fields,
   * so we intentionally cast the minimal fragment as `any` to keep this generator pure
   * and avoid accidentally overriding platform defaults.
   */
  const pack: Partial<PlatformLlmConfig> = {
    prompts: {
      industryPromptPacks: {
        [industryKey]: {
          quoteEstimatorSystem,
          qaQuestionGeneratorSystem,
          renderPromptAddendum,
          renderNegativeGuidance,
        },
      },
    } as any,
  };

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