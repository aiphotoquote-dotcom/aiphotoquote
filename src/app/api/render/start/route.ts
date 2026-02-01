// src/app/api/render/start/route.ts
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

function normalizeDbErr(err: any) {
  return {
    name: err?.name,
    message: err?.message ?? String(err),
    code: err?.code ?? err?.cause?.code,
    detail: err?.detail ?? err?.cause?.detail,
    hint: err?.hint ?? err?.cause?.hint,
    table: err?.table,
    column: err?.column,
    constraint: err?.constraint,
    causeMessage: err?.cause?.message,
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

// ---- DB helpers ----

async function getTenantBySlug(tenantSlug: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug)).limit(1);
  return rows[0] ?? null;
}

// best-effort: tenant_settings.ai_rendering_enabled
async function isTenantRenderingEnabled(tenantId: string): Promise<boolean | null> {
  try {
    const r = await db.execute(sql`
      select ai_rendering_enabled
      from tenant_settings
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);
    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
    if (typeof row?.ai_rendering_enabled === "boolean") return row.ai_rendering_enabled;
    return null;
  } catch {
    return null;
  }
}

function pickRenderOptInFromRecord(args: { row: any; renderingCols: boolean }) {
  const { row, renderingCols } = args;

  if (renderingCols && typeof row?.render_opt_in === "boolean") return row.render_opt_in;

  const input = safeJsonParse(row?.input) ?? {};
  if (typeof input?.render_opt_in === "boolean") return input.render_opt_in;
  if (typeof input?.customer_context?.render_opt_in === "boolean") return input.customer_context.render_opt_in;

  const output = safeJsonParse(row?.output) ?? {};
  if (typeof output?.meta?.render_opt_in === "boolean") return output.meta.render_opt_in;
  if (typeof output?.output?.render_opt_in === "boolean") return output.output.render_opt_in;

  return false;
}

async function updateQuoteLogOutputMerge(quoteLogId: string, patch: any) {
  const patchStr = JSON.stringify(patch ?? {});
  await db.execute(sql`
    update quote_logs
    set output = coalesce(output, '{}'::jsonb) || ${patchStr}::jsonb
    where id = ${quoteLogId}::uuid
  `);
}

/**
 * Best-effort: set render_status='queued' + render_prompt if render columns exist.
 * If those columns don't exist, we just return columns:false and rely on render_jobs as source of truth.
 */
async function markRenderQueuedBestEffort(args: { quoteLogId: string; prompt: string }) {
  const { quoteLogId, prompt } = args;
  try {
    await db.execute(sql`
      update quote_logs
      set
        render_status = 'queued',
        render_prompt = ${prompt},
        render_error = null
      where id = ${quoteLogId}::uuid
    `);
    return { ok: true as const, columns: true as const };
  } catch (e: any) {
    const msg = e?.message ?? e?.cause?.message ?? "";
    const code = e?.code ?? e?.cause?.code;
    const isUndefinedColumn = code === "42703" || /column .*render_/i.test(msg);
    if (!isUndefinedColumn) return { ok: false as const, columns: false as const, dbErr: normalizeDbErr(e) };
    return { ok: true as const, columns: false as const };
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

// ---- Route ----

export async function POST(req: Request) {
  const debugId = crypto.randomBytes(6).toString("hex");
  const startedAt = Date.now();

  try {
    const raw = await req.json().catch(() => null);
    const parsed = Req.safeParse(raw);
    if (!parsed.success) {
      return json(
        { ok: false, error: "BAD_REQUEST_VALIDATION", issues: parsed.error.issues, received: raw },
        400,
        debugId
      );
    }

    const { tenantSlug, quoteLogId } = parsed.data;

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return json({ ok: false, error: "TENANT_NOT_FOUND" }, 404, debugId);
    const tenantId = (tenant as any).id as string;

    // Tenant must allow rendering
    const enabled = await isTenantRenderingEnabled(tenantId);
    if (enabled !== true) {
      return json(
        {
          ok: false,
          error: "RENDERING_DISABLED",
          message: enabled === false ? "Tenant disabled AI rendering." : "Tenant rendering setting unknown.",
        },
        400,
        debugId
      );
    }

    // Load quote log (try render columns first)
    let quoteRow: any = null;
    let renderingCols = true;

    try {
      const rNew = await db.execute(sql`
        select
          id,
          tenant_id,
          input,
          output,
          render_opt_in,
          render_status,
          render_image_url,
          render_prompt,
          render_error,
          rendered_at
        from quote_logs
        where id = ${quoteLogId}::uuid
        limit 1
      `);
      quoteRow = (rNew as any)?.rows?.[0] ?? (Array.isArray(rNew) ? (rNew as any)[0] : null);
    } catch {
      renderingCols = false;
      const rOld = await db.execute(sql`
        select id, tenant_id, input, output
        from quote_logs
        where id = ${quoteLogId}::uuid
        limit 1
      `);
      quoteRow = (rOld as any)?.rows?.[0] ?? (Array.isArray(rOld) ? (rOld as any)[0] : null);
    }

    if (!quoteRow) return json({ ok: false, error: "QUOTE_NOT_FOUND" }, 404, debugId);
    if (String(quoteRow.tenant_id) !== String(tenantId)) return json({ ok: false, error: "TENANT_MISMATCH" }, 403, debugId);

    // Idempotency: if already rendered, no enqueue
    if (renderingCols) {
      const status = String(quoteRow.render_status ?? "");
      const url = quoteRow.render_image_url ? String(quoteRow.render_image_url) : null;
      if (status === "rendered" && url) {
        return json(
          { ok: true, quoteLogId, status: "rendered", imageUrl: url, durationMs: Date.now() - startedAt },
          200,
          debugId
        );
      }
    } else {
      const out = safeJsonParse(quoteRow.output) ?? {};
      const r = out?.rendering ?? null;
      if (r?.status === "rendered" && r?.imageUrl) {
        return json(
          { ok: true, quoteLogId, status: "rendered", imageUrl: String(r.imageUrl), durationMs: Date.now() - startedAt },
          200,
          debugId
        );
      }
    }

    // If cron job already queued/running, no enqueue
    const existing = await findExistingQueuedJob(quoteLogId);
    if (existing) {
      return json(
        {
          ok: true,
          quoteLogId,
          status: existing.status,
          jobId: existing.id,
          skipped: true,
          reason: "already_queued_or_running",
          durationMs: Date.now() - startedAt,
        },
        200,
        debugId
      );
    }

    // Must be opted-in
    const optIn = pickRenderOptInFromRecord({ row: quoteRow, renderingCols });
    if (!optIn) {
      return json({ ok: false, error: "NOT_OPTED_IN", message: "Customer did not opt in to AI rendering." }, 400, debugId);
    }

    // Pull images + context (prompt seed)
    const input = safeJsonParse(quoteRow.input) ?? {};
    const images: string[] = Array.isArray(input?.images) ? input.images.map((x: any) => x?.url).filter(Boolean) : [];
    if (!images.length) {
      return json({ ok: false, error: "NO_IMAGES", message: "No images stored on quote log input." }, 400, debugId);
    }

    const customerCtx = input?.customer_context ?? {};
    const notes = (customerCtx?.notes ?? "").toString().trim();
    const category = (customerCtx?.category ?? "").toString().trim();
    const serviceType = (customerCtx?.service_type ?? "").toString().trim();

    // This prompt is what cron will use (and what debug will prove)
    const prompt = [
      "Create a realistic concept 'after' rendering of the finished upholstery/service outcome.",
      "This is a second-step visual preview. Do NOT provide pricing. Do NOT provide text overlays.",
      "Output should look like a professional shop result, clean and plausible.",
      "Preserve the subject and original photo perspective as much as possible.",
      category ? `Category: ${category}` : "",
      serviceType ? `Service type: ${serviceType}` : "",
      notes ? `Customer notes: ${notes}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // Best-effort: reflect queued in quote_logs if columns exist
    const queuedMark = await markRenderQueuedBestEffort({ quoteLogId, prompt });

    // Also best-effort: reflect queued state in output JSON (helps when render cols don't exist)
    try {
      await updateQuoteLogOutputMerge(quoteLogId, {
        rendering: {
          requested: true,
          status: "queued",
          prompt,
          queuedAt: new Date().toISOString(),
        },
      });
    } catch {
      // ignore
    }

    // ✅ REAL queue action: insert render_jobs row
    const jobId = await enqueueRenderJob({ tenantId, quoteLogId, prompt });

    return json(
      {
        ok: true,
        quoteLogId,
        status: "queued",
        jobId,
        queuedMark,
        durationMs: Date.now() - startedAt,
      },
      200,
      debugId
    );
  } catch (err: any) {
    return json(
      { ok: false, error: "REQUEST_FAILED", message: err?.message ?? String(err) },
      500,
      crypto.randomBytes(6).toString("hex")
    );
  }
}