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

  if (!s || s === "not_requested" || s === "queued") return "idle";
  if (s === "running") return "running";
  if (s === "rendered") return "rendered";
  if (s === "failed") return "failed";

  return "idle";
}

function isUuidLike(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

async function loadLatestRenderJob(tenantId: string, quoteLogId: string) {
  const r = await db.execute(sql`
    select
      id,
      status,
      created_at,
      started_at,
      finished_at,
      error
    from render_jobs
    where tenant_id = ${tenantId}::uuid
      and quote_log_id = ${quoteLogId}::uuid
    order by created_at desc
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  if (!row) return null;

  return {
    id: String(row.id),
    status: String(row.status ?? ""),
    createdAt: row.created_at ?? null,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
    error: row.error ? String(row.error) : null,
  };
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

    const r = tenantIsUuid
      ? await db.execute(sql`
          select
            t.id as tenant_id,
            t.slug as tenant_slug,
            q.id as quote_log_id,
            q.render_status,
            q.render_image_url,
            q.render_error
          from quote_logs q
          join tenants t on t.id = q.tenant_id
          where t.id = ${tenantSlug}::uuid
            and q.id = ${quoteLogId}::uuid
          limit 1
        `)
      : await db.execute(sql`
          select
            t.id as tenant_id,
            t.slug as tenant_slug,
            q.id as quote_log_id,
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
      return json(
        {
          ok: false,
          error: "NOT_FOUND",
          message: "Quote not found",
          debug: debug
            ? {
                received: { tenantSlug, quoteLogId },
                tenantSlugInterpretation: tenantIsUuid ? "tenant_id_uuid" : "tenant_slug",
              }
            : undefined,
        },
        404
      );
    }

    const tenantId = String(row.tenant_id ?? "");
    const rawStatus = row.render_status;
    const imageUrl = row.render_image_url ? String(row.render_image_url) : null;
    const error = row.render_error ? String(row.render_error) : null;

    let renderStatus = normalizeStatus(rawStatus);

    // ✅ Contract hardening: if imageUrl exists and not failed, treat as rendered.
    if (imageUrl && renderStatus !== "failed") {
      renderStatus = "rendered";
    }

    const headers: Record<string, string> = {
      "x-apq-tenant-slug": String(row.tenant_slug ?? ""),
      "x-apq-tenant-id": tenantId,
      "x-apq-quote-log-id": String(row.quote_log_id ?? ""),
      "x-apq-render-status": String(renderStatus),
      "x-apq-has-image-url": imageUrl ? "1" : "0",
    };

    let latestJob: any = null;
    if (debug && tenantId) {
      try {
        latestJob = await loadLatestRenderJob(tenantId, quoteLogId);
      } catch {
        latestJob = { error: "FAILED_TO_LOAD_RENDER_JOB" };
      }
    }

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
                tenantSlugInterpretation: tenantIsUuid ? "tenant_id_uuid" : "tenant_slug",
                matched: {
                  tenantId,
                  tenantSlug: String(row.tenant_slug ?? ""),
                  quoteLogId: String(row.quote_log_id ?? ""),
                },
                db: {
                  render_status: rawStatus == null ? null : String(rawStatus),
                  render_image_url_present: Boolean(imageUrl),
                  render_image_url: imageUrl,
                  render_error: error,
                },
                latestRenderJob: latestJob,
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