// src/app/api/pcc/llm/config/route.ts
import { NextResponse } from "next/server";
import { requirePlatformRole } from "@/lib/rbac/guards";
import { savePlatformLlmConfig } from "@/lib/pcc/llm/store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  await requirePlatformRole(["platform_owner", "platform_admin"]);

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: false, message: "Invalid JSON" }, { status: 400 });

  await savePlatformLlmConfig(body);
  return NextResponse.json({ ok: true });
}