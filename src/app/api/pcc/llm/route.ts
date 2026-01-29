// src/app/api/pcc/llm/route.ts
import { NextResponse } from "next/server";
import { requirePlatformRole } from "@/lib/rbac/guards";
import { loadPlatformLlmConfig, savePlatformLlmConfig, validatePlatformLlmConfig } from "@/lib/pcc/llm/store";

export const runtime = "nodejs";

export async function GET() {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);
  const cfg = await loadPlatformLlmConfig();
  return NextResponse.json({ ok: true, config: cfg, sourceUrl: (process.env.PLATFORM_LLM_CONFIG_URL || "").trim() || null });
}

export async function POST(req: Request) {
  await requirePlatformRole(["platform_owner", "platform_admin"]);

  const body = await req.json().catch(() => null);
  const incoming = body?.config ?? body;

  const validated = validatePlatformLlmConfig(incoming);
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: "INVALID_CONFIG", message: validated.error }, { status: 400 });
  }

  const { url } = await savePlatformLlmConfig(validated.value);
  return NextResponse.json({ ok: true, url });
}