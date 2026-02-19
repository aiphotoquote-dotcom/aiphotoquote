// src/app/api/render/status/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import crypto from "crypto";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Req = z.object({
  tenantSlug: z.string().min(3),
  quoteLogId: z.string().uuid(),
});

function json(data: any, status = 200, debugId?: string) {
  const res = NextResponse.json(debugId ? { debugId, ...data } : data, { status });
  if (debugId) res.headers.set("x-debug-id", debugId);
  return res;
}

type DebugFn = (stage: string, data?: Record<string, any>) => void;

function mkDebug(debugId: string): DebugFn {
  return (stage, data) => {
    console.log(
      JSON.stringify({
        tag: "apq_debug",
        debugId,
        route: "/api/render/status",
        stage,
        ts: new Date().toISOString(),
        ...(data || {}),
      })
    );
  };
}

function safeJsonParse(v: any) {
  try {
    if (v == null) return null;
    if (typeof v === "object") return v;
    if (typeof v === "string") return JSON.parse(v);
    return v;
  } catch {
    return null;
  }
}

async function getTenantBySlug(tenantSlug: string) {
  const rows = await db.select({ id: tenants.id, slug: tenants.slug }).from(tenants).where(eq(tenants.slug, tenantSlug)).limit(1);
  return rows[0] ?? null;
}

async function readLatestJobForQuote(quoteLogId: string) {
  try {
    const r = await db.execute(sql`
      select
        id,
        status,
        updated_at,
        created_at
      from render_jobs
      where quote_log_id = ${quoteLogId}::uuid
      order by created_at desc
      limit 1
    `);
    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
    if (!row) return null;
    return {
      jobId: String(row.id),
      jobStatus: String(row.status),
      jobUpdatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      jobCreatedAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const debugId = crypto.randomBytes(6).toString("hex");
  const debug = mkDebug(debugId);

  try {
    const raw = await req.json().catch(() => null);
    const parsed = Req.safeParse(raw);
    if (!parsed.success) {
      debug("request.bad_body", { issuesCount: parsed.error.issues?.length ?? 0 });
      return json({ ok: false, error: "BAD_REQUEST_VALIDATION", issues: parsed.error.issues }, 400, debugId);
    }

    const { tenantSlug, quoteLogId } = parsed.data;
    debug("request.start", { tenantSlug, quoteLogId });

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      debug("tenant.not_found", { tenantSlug });
      return json({ ok: false, error: "TENANT_NOT_FOUND" }, 404, debugId);
    }
    const tenantId = String(tenant.id);
    debug("tenant.found", { tenantId });

    // Always try to read render_jobs latest row (helps diagnose “stuck at 92%”)
    const job = await readLatestJobForQuote(quoteLogId);
    debug("renderJobs.latest", { found: Boolean(job), ...(job ?? {}) });

    // Prefer new render columns if they exist; fallback to output.rendering.
    let row: any = null;
    let hasCols = true;

    try {
      const rNew = await db.execute(sql`
        select
          id,
          tenant_id,
          output,
          render_status,
          render_image_url,
          render_error
        from quote_logs
        where id = ${quoteLogId}::uuid
          and tenant_id = ${tenantId}::uuid
        limit 1
      `);
      row = (rNew as any)?.rows?.[0] ?? (Array.isArray(rNew) ? (rNew as any)[0] : null);
    } catch (e: any) {
      hasCols = false;
      debug("quoteLogs.renderCols.missing_or_query_failed", { message: e?.message ?? "unknown" });

      const rOld = await db.execute(sql`
        select id, tenant_id, output
        from quote_logs
        where id = ${quoteLogId}::uuid
          and tenant_id = ${tenantId}::uuid
        limit 1
      `);
      row = (rOld as any)?.rows?.[0] ?? (Array.isArray(rOld) ? (rOld as any)[0] : null);
    }

    if (!row) {
      debug("quoteLog.not_found", { quoteLogId, tenantId });
      return json({ ok: false, error: "QUOTE_NOT_FOUND" }, 404, debugId);
    }

    // Compute status from quote_logs first
    let status = "idle";
    let imageUrl: string | null = null;
    let error: string | null = null;

    if (hasCols) {
      status = String(row.render_status ?? "idle");
      imageUrl = row.render_image_url ? String(row.render_image_url) : null;
      error = row.render_error ? String(row.render_error) : null;
    } else {
      const out = safeJsonParse(row.output) ?? {};
      const r = out?.rendering ?? null;

      status = String(r?.status ?? "idle");
      imageUrl = r?.imageUrl ? String(r.imageUrl) : null;
      error = r?.error ? String(r.error) : null;
    }

    // If quote_logs says idle/queued but render_jobs says running/queued, surface the job truth too.
    // (We do NOT override quote_logs status here — worker should be the source of truth — but we *expose* it.)
    debug("status.computed", { status, hasImageUrl: Boolean(imageUrl), hasError: Boolean(error), hasCols });

    return json(
      {
        ok: true,
        quoteLogId,
        status,
        imageUrl,
        error,

        // extra diagnostics for “stuck” investigations
        job: job ?? null,
        source: hasCols ? "quote_logs.columns" : "quote_logs.output.rendering",
      },
      200,
      debugId
    );
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    console.log(
      JSON.stringify({
        tag: "apq_debug",
        debugId,
        route: "/api/render/status",
        stage: "request.error",
        ts: new Date().toISOString(),
        message: msg,
      })
    );

    return json({ ok: false, error: "REQUEST_FAILED", message: msg }, 500, debugId);
  }
}