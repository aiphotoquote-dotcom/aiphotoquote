// src/app/api/pcc/llm/config/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { requirePlatformRole } from "@/lib/rbac/guards";
import { getActorContext } from "@/lib/rbac/actor";
import {
  loadPlatformLlmConfig,
  savePlatformLlmConfig,
  resetPlatformLlmConfig,
  type PlatformLlmConfig,
} from "@/lib/pcc/llm/store";

export const runtime = "nodejs";

const ConfigSchema: z.ZodType<PlatformLlmConfig> = z.object({
  version: z.number().int().min(1),

  models: z.object({
    estimatorModel: z.string().min(1),
    qaModel: z.string().min(1),
    renderModel: z.string().optional(),
  }),

  prompts: z.object({
    quoteEstimatorSystem: z.string().min(1),
    qaQuestionGeneratorSystem: z.string().min(1),
    extraSystemPreamble: z.string().optional(),
  }),

  guardrails: z.object({
    blockedTopics: z.array(z.string()).default([]),
    maxQaQuestions: z.number().int().min(1).max(10),
    maxOutputTokens: z.number().int().min(128).max(8192).optional(),
  }),

  updatedAt: z.string().min(8),
});

const PostBodySchema = z.object({
  config: ConfigSchema,
});

const ResetBodySchema = z.object({
  reset: z.literal(true),
});

export async function GET() {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const actor = await getActorContext();
  const cfg = await loadPlatformLlmConfig();

  return NextResponse.json({
    ok: true,
    actor: { clerkUserId: actor.clerkUserId, email: actor.email ?? null },
    config: cfg,
  });
}

export async function POST(req: Request) {
  await requirePlatformRole(["platform_owner", "platform_admin"]);

  const actor = await getActorContext();

  const body = await req.json().catch(() => null);

  // Reset endpoint via POST { reset: true }
  const resetParsed = ResetBodySchema.safeParse(body);
  if (resetParsed.success) {
    await resetPlatformLlmConfig();
    const cfg = await loadPlatformLlmConfig();
    return NextResponse.json({
      ok: true,
      reset: true,
      actor: { clerkUserId: actor.clerkUserId, email: actor.email ?? null },
      config: cfg,
    });
  }

  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "INVALID_BODY", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  // Stamp updatedAt server-side (don’t trust client clock)
  const cfg: PlatformLlmConfig = {
    ...parsed.data.config,
    updatedAt: new Date().toISOString(),
  };

  await savePlatformLlmConfig(cfg);

  return NextResponse.json({
    ok: true,
    actor: { clerkUserId: actor.clerkUserId, email: actor.email ?? null },
    config: cfg,
  });
}