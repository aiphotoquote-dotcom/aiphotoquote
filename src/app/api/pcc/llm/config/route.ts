// src/app/api/pcc/llm/config/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformRole } from "@/lib/rbac/guards";
import { loadPlatformLlmConfig, savePlatformLlmConfig } from "@/lib/pcc/llm/store";
import type { PlatformLlmConfig } from "@/lib/pcc/llm/types";

export const runtime = "nodejs";

const GuardrailsSchema = z
  .object({
    mode: z.enum(["strict", "balanced", "permissive"]).optional(),
    piiHandling: z.enum(["redact", "allow", "deny"]).optional(),
    blockedTopics: z.array(z.string()).optional(),
    maxQaQuestions: z.number().int().min(1).max(10).optional(),
    maxOutputTokens: z.number().int().min(200).max(4000).optional(),
  })
  .partial()
  .optional();

const ModelsSchema = z
  .object({
    estimatorModel: z.string().min(1).optional(),
    qaModel: z.string().min(1).optional(),
    renderModel: z.string().min(1).optional(),
  })
  .partial()
  .optional();

// Accept BOTH `prompts` and legacy `promptSets`
const PromptsSchema = z
  .object({
    quoteEstimatorSystem: z.string().optional(),
    qaQuestionGeneratorSystem: z.string().optional(),
  })
  .partial()
  .optional();

const PlatformLlmConfigSchema = z.object({
  version: z.number().int().optional(),
  updatedAt: z.string().nullable().optional(),

  models: ModelsSchema,
  prompts: PromptsSchema,
  promptSets: PromptsSchema, // legacy alias
  guardrails: GuardrailsSchema,
});

function normalizeConfig(input: any): PlatformLlmConfig {
  const parsed = PlatformLlmConfigSchema.parse(input);

  const models = parsed.models ?? {};
  const prompts = (parsed.prompts ?? parsed.promptSets ?? {}) as any;
  const guardrails = parsed.guardrails ?? ({} as any);

  const blockedTopics = Array.isArray(guardrails.blockedTopics)
    ? guardrails.blockedTopics.map((s: any) => String(s).trim()).filter(Boolean)
    : [];

  const maxQaQuestionsRaw = Number(guardrails.maxQaQuestions ?? 3);
  const maxQaQuestions = Number.isFinite(maxQaQuestionsRaw)
    ? Math.max(1, Math.min(10, Math.floor(maxQaQuestionsRaw)))
    : 3;

  const maxOutputTokensRaw = Number(guardrails.maxOutputTokens ?? 900);
  const maxOutputTokens = Number.isFinite(maxOutputTokensRaw)
    ? Math.max(200, Math.min(4000, Math.floor(maxOutputTokensRaw)))
    : 900;

  const modeRaw = String((guardrails as any).mode ?? "balanced");
  const mode = (modeRaw === "strict" || modeRaw === "balanced" || modeRaw === "permissive"
    ? modeRaw
    : "balanced") as any;

  const piiRaw = String((guardrails as any).piiHandling ?? "redact");
  const piiHandling = (piiRaw === "redact" || piiRaw === "allow" || piiRaw === "deny" ? piiRaw : "redact") as any;

  return {
    version: parsed.version ?? 1,
    updatedAt: parsed.updatedAt ?? null,

    models: {
      estimatorModel: String(models.estimatorModel ?? "gpt-4o-mini").trim() || "gpt-4o-mini",
      qaModel: String(models.qaModel ?? "gpt-4o-mini").trim() || "gpt-4o-mini",
      renderModel: String(models.renderModel ?? "gpt-4o-mini").trim() || "gpt-4o-mini",
    },

    // Your type uses `prompts` (per the TS error you saw). Keep that shape.
    prompts: {
      quoteEstimatorSystem: String(prompts.quoteEstimatorSystem ?? "").trim(),
      qaQuestionGeneratorSystem: String(prompts.qaQuestionGeneratorSystem ?? "").trim(),
    } as any,

    guardrails: {
      mode,
      piiHandling,
      blockedTopics,
      maxQaQuestions,
      maxOutputTokens,
    } as any,
  } as PlatformLlmConfig;
}

export async function GET(_req: Request) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const cfg = await loadPlatformLlmConfig();
  const normalized = normalizeConfig(cfg);

  return NextResponse.json(
    { ok: true, config: normalized },
    {
      headers: {
        "cache-control": "no-store",
      },
    }
  );
}

export async function POST(req: Request) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY", message: "Missing JSON body." }, { status: 400 });
  }

  // Accept either:
  // 1) { config: <PlatformLlmConfig> }
  // 2) <PlatformLlmConfig>
  const candidate = (body as any).config ?? body;

  try {
    const normalized = normalizeConfig(candidate);

    await savePlatformLlmConfig(normalized);

    // Re-load after save (single source of truth)
    const saved = await loadPlatformLlmConfig();
    const out = normalizeConfig(saved);

    return NextResponse.json({ ok: true, config: out });
  } catch (e: any) {
    // Zod errors will have .issues
    const issues = e?.issues ?? undefined;
    return NextResponse.json(
      { ok: false, error: "VALIDATION_FAILED", message: e?.message ?? String(e), issues },
      { status: 400 }
    );
  }
}