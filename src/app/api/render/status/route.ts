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

function normalizeStatus(args: {
  renderingCols: boolean;
  row: any;
}): { status: "queued" | "running" | "rendered" | "failed" | "idle"; imageUrl: string | null; error: string | null } {
  const { renderingCols, row } = args;

  // --- Prefer explicit render_* columns if present ---
  if (renderingCols) {
    const rs = row?.render_status != null ? String(row.render_status) : "";
    const url = row?.render_image_url ? String(row.render_image_url) : null;
    const err = row?.render_error ? String(row.render_error) : null;

    const s = rs.toLowerCase();

    if ((s === "rendered" || s === "completed" || s === "done") && url) {
      return { status: "rendered", imageUrl: url, error: null };
    }

    if (s === "failed" || s === "error") {
      return { status: "failed", imageUrl: url, error: err ?? "Render failed" };
    }

    if (s === "queued") return { status: "queued", imageUrl: null, error: null };
    if (s === "running" || s === "processing" || s === "rendering") return { status: "running", imageUrl: null, error: null };

    // If status is empty but we have a URL, treat as rendered
    if (!s && url) return { status: "rendered", imageUrl: url, error: null };

    // If status is set but unknown, report "running" to keep UI progressing
    if (s) return { status: "running", imageUrl: null, error: null };
  }

  // --- Fallback: read from quote_logs.output JSON (schema drift safe) ---
  const out = safeJsonParse(row?.output) ?? {};
  const rendering = out?.rendering ?? out?.output?.rendering ?? null;

  // Expected fallback shape:
  // output.rendering = { status:"rendered"|"failed"|..., imageUrl, error }
  const st = rendering?.status != null ? String(rendering.status).toLowerCase() : "";
  const imageUrl =
    rendering?.imageUrl ? String(rendering.imageUrl) :
    rendering?.render_image_url ? String(rendering.render_image_url) :
    null;
  const error =
    rendering?.error ? String(rendering.error) :
    rendering?.render_error ? String(rendering.render_error) :
    null;

  if (st === "rendered" && imageUrl) return { status: "rendered", imageUrl, error: null };
  if (st === "failed") return { status: "failed", imageUrl, error: error ?? "Render failed" };
  if (st === "queued") return { status: "queued", imageUrl: null, error: null };
  if (st === "running" || st === "processing" || st === "rendering") return { status: "running", imageUrl: null, error: null };

  // Some older shapes might store a top-level render_status / render_image_url in output
  const st2 = out?.render_status != null ? String(out.render_status).toLowerCase() : "";
  const url2 = out?.render_image_url ? String(out.render_image_url) : null;
  const err2 = out?.render_error ? String(out.render_error) : null;

  if (st2 === "rendered" && url2) return { status: "rendered", imageUrl: url2, error: null };
  if (st2 === "failed") return { status: "failed", imageUrl: url2, error: err2 ?? "Render failed" };
  if (st2 === "queued") return { status: "queued", imageUrl: null, error: null };
  if (st2 === "running" || st2 === "processing" || st2 === "rendering") return { status: "running", imageUrl: null, error: null };

  // Unknown / not requested yet
  return { status: "idle", imageUrl: null, error: null };
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

    // Load quote log (try render columns first)
    let row: any = null;
    let renderingCols = true;

    try {
      const rNew = await db.execute(sql`
        select
          id,
          tenant_id,
          output,
          render_status,
          render_image_url,
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
        select id, tenant_id, output
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

    const norm = normalizeStatus({ renderingCols, row });

    return json(
      {
        ok: true,
        tenantSlug,
        quoteLogId,
        status: norm.status, // "idle" | "queued" | "running" | "rendered" | "failed"
        imageUrl: norm.imageUrl,
        error: norm.error,
        durationMs: Date.now() - startedAt,
      },
      200,
      debugId
    );
  } catch (e: any) {
    return json(
      {
        ok: false,
        error: "REQUEST_FAILED",
        message: e?.message ?? String(e),
        dbErr: normalizeDbErr(e),
      },
      500,
      debugId
    );
  }
}
