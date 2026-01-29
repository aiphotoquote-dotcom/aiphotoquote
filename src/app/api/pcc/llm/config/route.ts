import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformRole } from "@/lib/rbac/guards";
import { loadPlatformLlmConfig, savePlatformLlmConfig } from "@/lib/pcc/llm/store";
import type { PlatformLlmConfig } from "@/lib/pcc/llm/types";

export const runtime = "nodejs";

/* ----------------------------- schemas ----------------------------- */

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

/* --------------------------- normalization -------------------------- */

function normalizeConfig(input: any): PlatformLlmConfig {
  const parsed = PlatformLlmConfigSchema.parse(input ?? {});

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

  const modeRaw = String(guardrails.mode ?? "balanced");
  const mode =
    modeRaw === "strict" || modeRaw === "balanced" || modeRaw === "permissive"
      ? modeRaw
      : "balanced";

  const piiRaw = String(guardrails.piiHandling ?? "redact");
  const piiHandling = piiRaw === "redact" || piiRaw === "allow" || piiRaw === "deny" ? piiRaw : "redact";

  return {
    version: parsed.version ?? 1,
    updatedAt: parsed.updatedAt ?? null,

    models: {
      estimatorModel: String(models.estimatorModel ?? "gpt-4o-mini").trim() || "gpt-4o-mini",
      qaModel: String(models.qaModel ?? "gpt-4o-mini").trim() || "gpt-4o-mini",
      renderModel: String(models.renderModel ?? "gpt-4o-mini").trim() || "gpt-4o-mini",
    },

    prompts: {
      quoteEstimatorSystem: String(prompts.quoteEstimatorSystem ?? "").trim(),
      qaQuestionGeneratorSystem: String(prompts.qaQuestionGeneratorSystem ?? "").trim(),
    },

    guardrails: {
      mode,
      piiHandling,
      blockedTopics,
      maxQaQuestions,
      maxOutputTokens,
    },
  };
}

/* ------------------------------- GET -------------------------------- */

export async function GET() {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const stored = (await loadPlatformLlmConfig()) ?? {};
  const normalized = normalizeConfig(stored);

  return NextResponse.json(
    { ok: true, config: normalized },
    { headers: { "cache-control": "no-store" } }
  );
}

/* ------------------------------- POST ------------------------------- */

export async function POST(req: Request) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY" }, { status: 400 });
  }

  const candidate = (body as any).config ?? body;

  try {
    const incoming = normalizeConfig(candidate);
    const existing = normalizeConfig((await loadPlatformLlmConfig()) ?? {});

    const next: PlatformLlmConfig = {
      ...incoming,
      version: (existing.version ?? 1) + 1, // ✅ auto-bump
      updatedAt: new Date().toISOString(),   // ✅ authoritative timestamp
    };

    await savePlatformLlmConfig(next);

    return NextResponse.json({ ok: true, config: next });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "VALIDATION_FAILED",
        message: e?.message ?? String(e),
        issues: e?.issues,
      },
      { status: 400 }
    );
  }
}