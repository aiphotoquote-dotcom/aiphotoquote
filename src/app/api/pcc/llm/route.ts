// src/app/api/pcc/llm/route.ts
// Back-compat shim: keep old path working at /api/pcc/llm
// This avoids brittle re-exports and avoids depending on handler signatures.

import { NextResponse } from "next/server";
import { requirePlatformRole } from "@/lib/rbac/guards";
import { loadPlatformLlmConfig, savePlatformLlmConfig } from "@/lib/pcc/llm/store";

export const runtime = "nodejs";

export async function GET() {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const cfg = await loadPlatformLlmConfig();

  return NextResponse.json(
    { ok: true, config: cfg },
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        pragma: "no-cache",
        expires: "0",
      },
    }
  );
}

export async function POST(req: Request) {
  await requirePlatformRole(["platform_owner", "platform_admin"]);

  const body = await req.json().catch(() => null);

  // Accept either shape:
  // - raw config object
  // - { config: <config> }
  const cfg = (body && typeof body === "object" && "config" in body ? (body as any).config : body) ?? null;

  const saved = await savePlatformLlmConfig(cfg);

  return NextResponse.json(
    { ok: true, config: saved },
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        pragma: "no-cache",
        expires: "0",
      },
    }
  );
}