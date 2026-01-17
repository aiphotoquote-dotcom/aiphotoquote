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
    code: err?.code,
    detail: err?.detail,
    hint: err?.hint,
    constraint: err?.constraint,
    table: err?.table,
    column: err?.column,
    where: err?.where,
    causeMessage: err?.cause?.message,
    causeCode: err?.cause?.code,
    causeDetail: err?.cause?.detail,
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

  // Prefer explicit column if it exists
  if (renderingCols && typeof row?.render_opt_in === "boolean") return row.render_opt_in;

  // Fall back to input JSON stored in quote_logs.input
  const input = safeJsonParse(row?.input) ?? {};
  if (typeof input?.render_opt_in === "boolean") return input.render_opt_in;

  // Fall back to output meta
  const output = safeJsonParse(row?.output) ?? {};
  if (typeof output?.meta?.render_opt_in === "boolean") return output.meta.render_opt_in;

  // Fall back to normalized output shape
  if (typeof output?.output?.render_opt_in === "boolean") return output.output.render_opt_in;

  return false;
}

function buildRenderPromptFromInput(input: any) {
  const customerCtx = input?.customer_context ?? {};
  const notes = (customerCtx?.notes ?? "").toString().trim();
  const category = (customerCtx?.category ?? "").toString().trim();
  const serviceType = (customerCtx?.service_type ?? "").toString().trim();

  return [
    "Create a realistic concept 'after' rendering of the finished upholstery/service outcome.",
    "This is a second-step visual preview. Do NOT provide pricing. Do NOT provide text overlays.",
    "Preserve the subject and original photo perspective as much as possible.",
    "Output should look like a professional shop result, clean and plausible.",
    category ? `Category: ${category}` : "",
    serviceType ? `Service type: ${serviceType}` : "",
    notes ? `Customer notes: ${notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function updateQuoteLogOutput(quoteLogId: string, output: any) {
  const outputStr = JSON.stringify(output ?? {});
  await db.execute(sql`
    update quote_logs
    set output = ${outputStr}::jsonb
    where id = ${quoteLogId}::uuid
  `);
}

async function markRenderQueuedBestEffort(args: { quoteLogId: string; prompt: string }) {
  const { quoteLogId, prompt } = args;

  // Try dedicated render_* columns first
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

    if (!isUndefinedColumn) {
      return { ok: false as const, columns: false as const, dbErr: normalizeDbErr(e) };
    }

    // Column drift: okay, caller will merge into output.rendering
    return { ok: true as const, columns: false as const };
  }
}

function normalizeExistingStatus(args: { renderingCols: boolean; row: any }) {
  const { renderingCols, row } = args;

  if (renderingCols) {
    const rs = row?.render_status != null ? String(row.render_status) : "";
    const url = row?.render_image_url ? String(row.render_image_url) : null;
    const err = row?.render_error ? String(row.render_error) : null;

    const s = rs.toLowerCase();
    if ((s === "rendered" || s === "completed" || s === "done") && url) return { status: "rendered" as const, imageUrl: url, error: null };
    if (s === "failed" || s === "error") return { status: "failed" as const, imageUrl: url, error: err ?? "Render failed" };
    if (s === "queued") return { status: "queued" as const, imageUrl: null, error: null };
    if (s === "running" || s === "processing" || s === "rendering") return { status: "running" as const, imageUrl: null, error: null };
    if (!s && url) return { status: "rendered" as const, imageUrl: url, error: null };
    if (s) return { status: "running" as const, imageUrl: null, error: null };
  }

  const out = safeJsonParse(row?.output) ?? {};
  const rendering = out?.rendering ?? out?.output?.rendering ?? null;

  const st = rendering?.status != null ? String(rendering.status).toLowerCase() : "";
  const imageUrl =
    rendering?.imageUrl ? String(rendering.imageUrl) :
    rendering?.render_image_url ? String(rendering.render_image_url) :
    null;
  const error =
    rendering?.error ? String(rendering.error) :
    rendering?.render_error ? String(rendering.render_error) :
    null;

  if (st === "rendered" && imageUrl) return { status: "rendered" as const, imageUrl, error: null };
  if (st === "failed") return { status: "failed" as const, imageUrl, error: error ?? "Render failed" };
  if (st === "queued") return { status: "queued" as const, imageUrl: null, error: null };
  if (st === "running" || st === "processing" || st === "rendering") return { status: "running" as const, imageUrl: null, error: null };

  return { status: "idle" as const, imageUrl: null, error: null };
}

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

    // Tenant gating (best-effort; if unknown treat as disabled)
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
    let row: any = null;
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
      row = (rNew as any)?.rows?.[0] ?? (Array.isArray(rNew) ? (rNew as any)[0] : null);
    } catch {
      renderingCols = false;
      const rOld = await db.execute(sql`
        select id, tenant_id, input, output
        from quote_logs
        where id = ${quoteLogId}::uuid
        limit 1
      `);
      row = (rOld as any)?.rows?.[0] ?? (Array.isArray(rOld) ? (rOld as any)[0] : null);
    }

    if (!row) return json({ ok: false, error: "QUOTE_NOT_FOUND" }, 404, debugId);
    if (String(row.tenant_id) !== String(tenantId)) {
      return json({ ok: false, error: "TENANT_MISMATCH" }, 403, debugId);
    }

    // Customer opt-in required
    const optIn = pickRenderOptInFromRecord({ row, renderingCols });
    if (!optIn) {
      return json(
        { ok: false, error: "NOT_OPTED_IN", message: "Customer did not opt in to AI rendering." },
        400,
        debugId
      );
    }

    // If already queued/running/rendered, return current state (idempotent)
    const existing = normalizeExistingStatus({ renderingCols, row });
    if (existing.status !== "idle") {
      return json(
        {
          ok: true,
          quoteLogId,
          status: existing.status,
          imageUrl: existing.imageUrl,
          error: existing.error,
          skipped: true,
          reason: "already_started",
          durationMs: Date.now() - startedAt,
        },
        200,
        debugId
      );
    }

    // Build prompt from stored input
    const input = safeJsonParse(row.input) ?? {};
    const prompt = buildRenderPromptFromInput(input);

    // Mark queued (best-effort)
    const queuedMark = await markRenderQueuedBestEffort({ quoteLogId, prompt });

    // If we DON'T have render columns, persist queued status inside output.rendering
    if (!queuedMark.columns) {
      try {
        const out = safeJsonParse(row.output) ?? {};
        const next = {
          ...out,
          rendering: {
            ...(out?.rendering ?? {}),
            requested: true,
            status: "queued",
            prompt,
            error: null,
            queuedAt: new Date().toISOString(),
          },
        };
        await updateQuoteLogOutput(quoteLogId, next);
      } catch (e: any) {
        // Do not fail start if this merge fails; UI can still call /status and we can proceed later.
      }
    }

    return json(
      {
        ok: true,
        quoteLogId,
        status: "queued",
        queuedMark,
        durationMs: Date.now() - startedAt,
      },
      200,
      debugId
    );
  } catch (e: any) {
    return json(
      { ok: false, error: "REQUEST_FAILED", message: e?.message ?? String(e), dbErr: normalizeDbErr(e) },
      500,
      debugId
    );
  }
}
