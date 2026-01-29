// src/app/api/pcc/llm/config/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { requirePlatformRole } from "@/lib/rbac/guards";
import { loadPlatformLlmConfig, savePlatformLlmConfig } from "@/lib/pcc/llm/store";

export const runtime = "nodejs";

const PlatformLlmConfigSchema = z.object({
  version: z.number().int().min(1),

  models: z.object({
    estimatorModel: z.string().min(1),
    qaModel: z.string().min(1),
    renderModel: z.string().min(1).optional(),
  }),

  prompts: z.object({
    quoteEstimatorSystem: z.string().min(1),
    qaQuestionGeneratorSystem: z.string().min(1),
    extraSystemPreamble: z.string().optional(),
  }),

  guardrails: z.object({
    blockedTopics: z.array(z.string()).default([]),
    maxQaQuestions: z.number().int().min(1).max(10),
    maxOutputTokens: z.number().int().min(128).max(8000).optional(),
  }),

  updatedAt: z.string().min(1),
});

export async function GET() {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const cfg = await loadPlatformLlmConfig();
  return NextResponse.json({ ok: true, config: cfg });
}

export async function POST(req: Request) {
  await requirePlatformRole(["platform_owner", "platform_admin"]);

  const body = await req.json().catch(() => null);
  const parsed = PlatformLlmConfigSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "INVALID_CONFIG", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  // Always stamp updatedAt server-side
  const nextCfg = {
    ...parsed.data,
    updatedAt: new Date().toISOString(),
  };

  await savePlatformLlmConfig(nextCfg);

  return NextResponse.json({ ok: true, config: nextCfg });
}