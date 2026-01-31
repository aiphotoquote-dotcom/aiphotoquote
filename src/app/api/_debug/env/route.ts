import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const pcc = String(process.env.PCC_RENDER_DEBUG ?? "").trim();

  return NextResponse.json({
    ok: true,
    now: new Date().toISOString(),
    vercel: {
      env: process.env.VERCEL_ENV ?? null,          // "production" | "preview" | "development"
      url: process.env.VERCEL_URL ?? null,
      region: process.env.VERCEL_REGION ?? null,
      gitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    },
    flags: {
      PCC_RENDER_DEBUG_raw: process.env.PCC_RENDER_DEBUG ?? null,
      PCC_RENDER_DEBUG_trimmed: pcc || null,
      PCC_RENDER_DEBUG_enabled: pcc === "1",
    },
  });
}