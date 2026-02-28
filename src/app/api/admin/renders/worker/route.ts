// src/app/api/admin/renders/worker/route.ts
import { NextResponse } from "next/server";
import { processOneQueuedRender } from "@/lib/renders/worker";

/**
 * Secure worker endpoint.
 *
 * Call it from:
 * - local: curl with x-apq-worker-secret
 * - Vercel Cron: scheduled POST with header
 *
 * Env:
 * - APQ_WORKER_SECRET (required)
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

export async function POST(req: Request) {
  const secret = process.env.APQ_WORKER_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Missing APQ_WORKER_SECRET env var" },
      { status: 500 }
    );
  }

  const got = req.headers.get("x-apq-worker-secret") || "";
  if (got !== secret) return unauthorized();

  const result = await processOneQueuedRender();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}