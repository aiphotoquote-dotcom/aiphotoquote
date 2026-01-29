// src/app/api/pcc/llm/route.ts
// Back-compat shim: keep old path working at /api/pcc/llm
// This avoids brittle re-exports and avoids depending on handler signatures.

import { NextResponse } from "next/server";
import { requirePlatformRole } from "@/lib/rbac/guards";
import {
  loadPlatformLlmConfig,
  savePlatformLlmConfig,
} from "@/lib/pcc/llm/store";

export const runtime = "nodejs";

export async function GET() {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const cfg = await loadPlatformLlmConfig();
  return NextResponse.json({ ok: true, config: cfg });
}

export async function POST(req: Request) {
  await requirePlatformRole(["platform_owner", "platform_admin"]);

  const body = await req.json().catch(() => null);
  // store.ts should validate; if it doesn't yet, this will still persist JSON.
  const saved = await savePlatformLlmConfig(body);

  return NextResponse.json({ ok: true, config: saved });
}