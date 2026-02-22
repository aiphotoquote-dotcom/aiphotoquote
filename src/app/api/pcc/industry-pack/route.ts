// src/app/api/pcc/industry-pack/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { requirePlatformRole } from "@/lib/rbac/guards";
import { loadPlatformLlmConfig, savePlatformLlmConfig } from "@/lib/pcc/llm/store";

const Body = z.object({
  industryKey: z.string().min(1),
  pack: z
    .object({
      extraSystemPreamble: z.string().nullable().optional(),
      quoteEstimatorSystem: z.string().nullable().optional(),
      qaQuestionGeneratorSystem: z.string().nullable().optional(),
      renderSystemAddendum: z.string().nullable().optional(),
      renderNegativeGuidance: z.string().nullable().optional(),
    })
    .nullable(),
});

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "BAD_REQUEST", message: "Invalid payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const industryKey = safeTrim(parsed.data.industryKey).toLowerCase();
  if (!industryKey) {
    return NextResponse.json({ ok: false, error: "BAD_REQUEST", message: "industryKey is required" }, { status: 400 });
  }

  const cfg = await loadPlatformLlmConfig();
  const next = { ...cfg };

  const packs = { ...(next.prompts.industryPromptPacks ?? {}) };

  if (parsed.data.pack === null) {
    // delete pack
    delete (packs as any)[industryKey];
  } else {
    const p = parsed.data.pack;

    // normalize: omit empty strings (store undefined)
    const pack: any = {};
    const fields = [
      "extraSystemPreamble",
      "quoteEstimatorSystem",
      "qaQuestionGeneratorSystem",
      "renderSystemAddendum",
      "renderNegativeGuidance",
    ] as const;

    for (const k of fields) {
      const v = p?.[k];
      const s = safeTrim(v ?? "");
      if (s) pack[k] = s;
    }

    packs[industryKey] = pack;
  }

  next.prompts = {
    ...next.prompts,
    industryPromptPacks: packs,
  };

  const saved = await savePlatformLlmConfig(next as any);

  return NextResponse.json({ ok: true, industryKey, savedAt: saved.updatedAt, hasPack: Boolean((packs as any)[industryKey]) });
}