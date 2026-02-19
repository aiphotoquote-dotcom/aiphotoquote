// src/app/api/render/start/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql, and } from "drizzle-orm";
import crypto from "crypto";

import { db } from "@/lib/db/client";
import { tenants, quoteLogs } from "@/lib/db/schema";

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
    // Always log JSON so Vercel shows it reliably.
    console.log(
      JSON.stringify({
        tag: "apq_debug",
        debugId,
        route: "/api/render/start",
        stage,
        ts: new Date().toISOString(),
        ...(data || {}),
      })
    );
  };
}

async function getTenantBySlug(tenantSlug: string) {
  const rows = await db.select({ id: tenants.id, slug: tenants.slug }).from(tenants).where(eq(tenants.slug, tenantSlug)).limit(1);
  return rows[0] ?? null;
}

async function getQuoteLogForTenant(args: { tenantId: string; quoteLogId: string }) {
  const rows = await db
    .select({
      id: quoteLogs.id,
      tenantId: quoteLogs.tenantId,
      renderStatus: quoteLogs.renderStatus,
      renderImageUrl: quoteLogs.renderImageUrl,
      renderError: quoteLogs.renderError,
    })
    .from(quoteLogs)
    .where(and(eq(quoteLogs.id, args.quoteLogId), eq(quoteLogs.tenantId, args.tenantId)))
    .limit(1);

  return rows[0] ?? null;
}

async function findExistingQueuedJob(quoteLogId: string): Promise<{ id: string; status: string } | null> {
  try {
    const r = await db.execute(sql`
      select id, status
      from render_jobs
      where quote_log_id = ${quoteLogId}::uuid
        and status in ('queued','running')
      order by created_at desc
      limit 1
    `);

    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
    if (!row) return null;

    return { id: String(row.id), status: String(row.status) };
  } catch {
    return null;
  }
}

async function enqueueRenderJob(args: { tenantId: string; quoteLogId: string; prompt: string }) {
  const jobId = crypto.randomUUID();
  await db.execute(sql`
    insert into render_jobs (id, tenant_id, quote_log_id, status, prompt, created_at)
    values (
      ${jobId}::uuid,
      ${args.tenantId}::uuid,
      ${args.quoteLogId}::uuid,
      'queued',
      ${args.prompt},
      now()
    )
  `);
  return jobId;
}

export async function POST(req: Request) {
  const debugId = crypto.randomBytes(6).toString("hex");
  const debug = mkDebug(debugId);
  const startedAt = Date.now();

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

    // ✅ Validate quote log belongs to tenant
    const ql = await getQuoteLogForTenant({ tenantId, quoteLogId });
    if (!ql) {
      debug("quoteLog.not_found_or_mismatch", { tenantId, quoteLogId });
      return json({ ok: false, error: "QUOTE_NOT_FOUND" }, 404, debugId);
    }

    // ✅ If already done, return done (don’t enqueue)
    const renderStatus = String((ql as any)?.renderStatus ?? "");
    const renderImageUrl = String((ql as any)?.renderImageUrl ?? "");
    if (renderStatus === "done" && renderImageUrl) {
      debug("render.already_done", { quoteLogId, renderStatus, hasUrl: true });
      return json(
        {
          ok: true,
          quoteLogId,
          status: "done",
          jobId: null,
          skipped: true,
          reason: "already_done",
          durationMs: Date.now() - startedAt,
        },
        200,
        debugId
      );
    }

    // ✅ If already queued/running, return existing job
    const existing = await findExistingQueuedJob(quoteLogId);
    if (existing) {
      debug("render.job.exists", { quoteLogId, jobId: existing.id, status: existing.status });

      // Ensure quote log reflects queued/running (helps UI not stick on stale state)
      await db
        .update(quoteLogs)
        .set({
          renderStatus: existing.status === "running" ? "running" : "queued",
          renderError: null,
        })
        .where(eq(quoteLogs.id, quoteLogId));

      return json(
        {
          ok: true,
          quoteLogId,
          status: existing.status,
          jobId: existing.id,
          skipped: true,
          durationMs: Date.now() - startedAt,
        },
        200,
        debugId
      );
    }

    // We store prompt in job as a *seed*; cron will rebuild final prompt from PCC for canonical behavior
    const prompt = "queued_by_api_render_start";

    const jobId = await enqueueRenderJob({ tenantId, quoteLogId, prompt });
    debug("render.job.enqueued", { quoteLogId, jobId });

    // ✅ Update quote log state so UI progresses immediately
    await db
      .update(quoteLogs)
      .set({
        renderStatus: "queued",
        renderError: null,
        renderPrompt: prompt,
      })
      .where(eq(quoteLogs.id, quoteLogId));

    debug("quoteLog.marked_queued", { quoteLogId });

    return json(
      {
        ok: true,
        quoteLogId,
        status: "queued",
        jobId,
        durationMs: Date.now() - startedAt,
      },
      200,
      debugId
    );
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    debug("request.error", { message: msg });
    return json({ ok: false, error: "REQUEST_FAILED", message: msg }, 500, debugId);
  }
}