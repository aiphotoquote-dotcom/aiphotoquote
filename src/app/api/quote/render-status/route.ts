// src/app/api/quote/render-status/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Q = z.object({
  tenantSlug: z.string().min(3),
  quoteLogId: z.string().uuid(),
});

function json(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

function normalizeStatus(raw: unknown): "idle" | "running" | "rendered" | "failed" {
  const s = String(raw ?? "").toLowerCase().trim();

  // treat not_requested / queued / empty as “idle” (queued UI)
  if (!s || s === "not_requested" || s === "queued") return "idle";
  if (s === "running") return "running";
  if (s === "rendered") return "rendered";
  if (s === "failed") return "failed";

  // anything else: be conservative
  return "idle";
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const parsed = Q.safeParse({
    tenantSlug: url.searchParams.get("tenantSlug"),
    quoteLogId: url.searchParams.get("quoteLogId"),
  });

  if (!parsed.success) {
    return json(
      { ok: false, error: "BAD_REQUEST", message: "Invalid query params", issues: parsed.error.issues },
      400
    );
  }

  const { tenantSlug, quoteLogId } = parsed.data;

  try {
    const r = await db.execute(sql`
      select
        q.render_status,
        q.render_image_url,
        q.render_error
      from quote_logs q
      join tenants t on t.id = q.tenant_id
      where t.slug = ${tenantSlug}
        and q.id = ${quoteLogId}::uuid
      limit 1
    `);

    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

    if (!row) {
      return json({ ok: false, error: "NOT_FOUND", message: "Quote not found" }, 404);
    }

    const imageUrl = row.render_image_url ? String(row.render_image_url) : null;
    const error = row.render_error ? String(row.render_error) : null;

    let renderStatus = normalizeStatus(row.render_status);

    // ✅ Contract hardening:
    // If an image URL exists and we are not explicitly failed, treat it as rendered.
    // This guarantees UI convergence even if render_status is stale/mismatched.
    if (imageUrl && renderStatus !== "failed") {
      renderStatus = "rendered";
    }

    return json({
      ok: true,
      renderStatus,
      imageUrl,
      error,
    });
  } catch (e: any) {
    return json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e ?? "Unknown error") },
      500
    );
  }
}