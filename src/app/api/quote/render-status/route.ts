// src/app/api/quote/render-status/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Q = z.object({
  tenantSlug: z.string().min(3), // may be slug OR tenant UUID (back-compat)
  quoteLogId: z.string().uuid(),
  debug: z.boolean().optional(),
});

function json(data: any, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      ...(headers ?? {}),
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

function isUuidLike(v: string) {
  // lightweight check (Postgres will validate via ::uuid when used)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const parsed = Q.safeParse({
    tenantSlug: url.searchParams.get("tenantSlug"),
    quoteLogId: url.searchParams.get("quoteLogId"),
    debug: url.searchParams.get("debug") === "1" || url.searchParams.get("debug") === "true",
  });

  if (!parsed.success) {
    return json(
      { ok: false, error: "BAD_REQUEST", message: "Invalid query params", issues: parsed.error.issues },
      400
    );
  }

  const { tenantSlug, quoteLogId, debug } = parsed.data;

  try {
    const tenantIsUuid = isUuidLike(tenantSlug);

    const r = await db.execute(sql`
      select
        t.id as tenant_id,
        t.slug as tenant_slug,
        q.id as quote_log_id,
        q.render_status,
        q.render_image_url,
        q.render_error
      from quote_logs q
      join tenants t on t.id = q.tenant_id
      where (
          (t.slug = ${tenantSlug} and ${tenantIsUuid} = false)
          or
          (t.id = ${tenantSlug}::uuid and ${tenantIsUuid} = true)
        )
        and q.id = ${quoteLogId}::uuid
      limit 1
    `);

    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

    if (!row) {
      return json(
        {
          ok: false,
          error: "NOT_FOUND",
          message: "Quote not found",
          debug: debug
            ? {
                received: { tenantSlug, quoteLogId },
                note: "tenantSlug may be slug or tenant UUID; no matching tenant+quote row was found",
              }
            : undefined,
        },
        404
      );
    }

    const rawStatus = row.render_status;
    const imageUrl = row.render_image_url ? String(row.render_image_url) : null;
    const error = row.render_error ? String(row.render_error) : null;

    let renderStatus = normalizeStatus(rawStatus);

    // ✅ Contract hardening:
    // If an image URL exists and we are not explicitly failed, treat it as rendered.
    if (imageUrl && renderStatus !== "failed") {
      renderStatus = "rendered";
    }

    const headers: Record<string, string> = {
      "x-apq-tenant-slug": String(row.tenant_slug ?? ""),
      "x-apq-tenant-id": String(row.tenant_id ?? ""),
      "x-apq-quote-log-id": String(row.quote_log_id ?? ""),
      "x-apq-render-status": String(renderStatus),
      "x-apq-has-image-url": imageUrl ? "1" : "0",
    };

    return json(
      {
        ok: true,
        renderStatus,
        imageUrl,
        error,
        ...(debug
          ? {
              debug: {
                received: { tenantSlug, quoteLogId },
                matched: {
                  tenantId: String(row.tenant_id ?? ""),
                  tenantSlug: String(row.tenant_slug ?? ""),
                  quoteLogId: String(row.quote_log_id ?? ""),
                },
                db: {
                  render_status: rawStatus == null ? null : String(rawStatus),
                  render_image_url_present: Boolean(imageUrl),
                  render_image_url: imageUrl,
                  render_error: error,
                },
              },
            }
          : {}),
      },
      200,
      headers
    );
  } catch (e: any) {
    return json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e ?? "Unknown error") },
      500
    );
  }
}