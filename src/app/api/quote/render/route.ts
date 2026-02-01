// src/app/api/quote/render/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Req = z.object({
  tenantSlug: z.string().min(3),
  quoteLogId: z.string().uuid(),
});

export async function POST(req: Request) {
  const debugId = `dbg_${Math.random().toString(36).slice(2, 10)}`;

  const body = await req.json().catch(() => null);
  const parsed = Req.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "BAD_REQUEST", message: "Invalid payload", issues: parsed.error.issues, debugId },
      { status: 400 }
    );
  }

  const { tenantSlug, quoteLogId } = parsed.data;

  // Canonical behavior: enqueue job via internal endpoint
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

  const url = `${String(baseUrl).replace(/\/+$/, "")}/api/render/start`;

  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantSlug, quoteLogId }),
    cache: "no-store",
  });

  const txt = await r.text();
  let j: any = null;
  try {
    j = txt ? JSON.parse(txt) : null;
  } catch {
    return NextResponse.json(
      { ok: false, error: "ENQUEUE_FAILED", message: `render/start returned non-JSON (HTTP ${r.status})`, debugId },
      { status: 500 }
    );
  }

  if (!r.ok || !j?.ok) {
    return NextResponse.json(
      { ok: false, error: "ENQUEUE_FAILED", message: j?.message || j?.error || `HTTP ${r.status}`, debugId },
      { status: 500 }
    );
  }

  // What the UI needs: show as running/queued, cron will finish even if user leaves
  return NextResponse.json({
    ok: true,
    quoteLogId,
    status: "queued",
    jobId: j.jobId ?? null,
    debugId,
  });
}