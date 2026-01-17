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

async function getTenantBySlug(tenantSlug: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug)).limit(1);
  return rows[0] ?? null;
}

function inferStatusFromOutputFallback(out: any): {
  status: "idle" | "queued" | "running" | "rendered" | "failed";
  imageUrl: string | null;
  error: string | null;
} {
  const rendering = out?.rendering ?? null;
  const status = String(rendering?.status ?? "idle");

  const imageUrl = rendering?.imageUrl ? String(rendering.imageUrl) : null;
  const error = rendering?.error ? String(rendering.error) : null;

  if (status === "queued" || status === "running" || status === "rendered" || status === "failed") {
    return { status, imageUrl, error };
  }

  // If we see an imageUrl but no status, assume rendered
  if (imageUrl) return { status: "rendered", imageUrl, error: null };

  // If we see an error but no status, assume failed
  if (error) return { status: "failed", imageUrl: null, error };

  return { status: "idle", imageUrl: null, error: null };
}

export async function POST(req: Request) {
  const debugId = crypto.randomBytes(6).toString("hex");

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

    // Try render columns first; if they don't exist, fall back to output.rendering
    let row: any = null;
    let hasColumns = true;

    try {
      const r = await db.execute(sql`
        select
          id,
          tenant_id,
          output,
          render_status,
          render_image_url,
          render_error,
          render_prompt,
          rendered_at
        from quote_logs
        where id = ${quoteLogId}::uuid
        limit 1
      `);
      row = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
    } catch {
      hasColumns = false;
      const r = await db.execute(sql`
        select id, tenant_id, output
        from quote_logs
        where id = ${quoteLogId}::uuid
        limit 1
      `);
      row = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
    }

    if (!row) return json({ ok: false, error: "QUOTE_NOT_FOUND" }, 404, debugId);
    if (String(row.tenant_id) !== String(tenantId)) return json({ ok: false, error: "TENANT_MISMATCH" }, 403, debugId);

    if (hasColumns) {
      const s = String(row.render_status ?? "idle");
      const status =
        s === "queued" || s === "running" || s === "rendered" || s === "failed" ? s : "idle";

      const imageUrl = row.render_image_url ? String(row.render_image_url) : null;
      const error = row.render_error ? String(row.render_error) : null;

      // If the status says rendered but we have no URL, attempt fallback from output JSON
      if (status === "rendered" && !imageUrl) {
        const out = safeJsonParse(row.output) ?? {};
        const fb = inferStatusFromOutputFallback(out);
        return json(
          {
            ok: true,
            quoteLogId,
            status: fb.status,
            imageUrl: fb.imageUrl,
            error: fb.error,
            source: "output_fallback",
          },
          200,
          debugId
        );
      }

      return json(
        {
          ok: true,
          quoteLogId,
          status,
          imageUrl,
          error,
          source: "columns",
        },
        200,
        debugId
      );
    }

    // No columns: infer from output.rendering
    const out = safeJsonParse(row.output) ?? {};
    const fb = inferStatusFromOutputFallback(out);

    return json(
      {
        ok: true,
        quoteLogId,
        status: fb.status,
        imageUrl: fb.imageUrl,
        error: fb.error,
        source: "output_rendering",
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
