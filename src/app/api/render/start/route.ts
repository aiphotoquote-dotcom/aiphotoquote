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

async function getTenantBySlug(tenantSlug: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug)).limit(1);
  return rows[0] ?? null;
}

// best-effort: tenant_settings.ai_rendering_enabled
async function isTenantRenderingEnabled(tenantId: string): Promise<boolean> {
  try {
    const r = await db.execute(sql`
      select ai_rendering_enabled
      from tenant_settings
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);

    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
    return row?.ai_rendering_enabled === true;
  } catch {
    return false;
  }
}

function pickRenderOptInFromQuoteRow(args: { row: any; hasRenderCols: boolean }) {
  const { row, hasRenderCols } = args;

  // Prefer dedicated column if it exists
  if (hasRenderCols && typeof row?.render_opt_in === "boolean") return row.render_opt_in;

  // Fall back to input JSON stored in quote_logs.input
  const input = safeJsonParse(row?.input) ?? {};
  const cc = input?.customer_context ?? {};
  if (typeof cc?.render_opt_in === "boolean") return cc.render_opt_in;
  if (typeof input?.render_opt_in === "boolean") return input.render_opt_in;

  // Fall back to meta/output
  const output = safeJsonParse(row?.output) ?? {};
  if (typeof output?.meta?.render_opt_in === "boolean") return output.meta.render_opt_in;
  if (typeof output?.output?.render_opt_in === "boolean") return output.output.render_opt_in;

  return false;
}

function buildRenderPromptFromQuoteRow(row: any) {
  const input = safeJsonParse(row?.input) ?? {};
  const cc = input?.customer_context ?? {};

  const notes = String(cc?.notes ?? "").trim();
  const category = String(cc?.category ?? "").trim();
  const serviceType = String(cc?.service_type ?? "").trim();

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

    // Tenant gating (hard)
    const enabled = await isTenantRenderingEnabled(tenantId);
    if (!enabled) {
      return json(
        { ok: false, error: "RENDERING_DISABLED", message: "Tenant disabled AI rendering." },
        400,
        debugId
      );
    }

    // Load quote log (schema-drift safe for render columns)
    let quoteRow: any = null;
    let hasRenderCols = true;

    try {
      const rNew = await db.execute(sql`
        select
          id,
          tenant_id,
          input,
          output,
          render_opt_in,
          render_status,
          render_image_url
        from quote_logs
        where id = ${quoteLogId}::uuid
        limit 1
      `);

      quoteRow = (rNew as any)?.rows?.[0] ?? (Array.isArray(rNew) ? (rNew as any)[0] : null);
    } catch {
      hasRenderCols = false;

      const rOld = await db.execute(sql`
        select id, tenant_id, input, output
        from quote_logs
        where id = ${quoteLogId}::uuid
        limit 1
      `);

      quoteRow = (rOld as any)?.rows?.[0] ?? (Array.isArray(rOld) ? (rOld as any)[0] : null);
    }

    if (!quoteRow) return json({ ok: false, error: "QUOTE_NOT_FOUND" }, 404, debugId);
    if (String(quoteRow.tenant_id) !== String(tenantId)) {
      return json({ ok: false, error: "TENANT_MISMATCH" }, 403, debugId);
    }

    // Customer opt-in required
    const optIn = pickRenderOptInFromQuoteRow({ row: quoteRow, hasRenderCols });
    if (!optIn) {
      return json(
        { ok: false, error: "NOT_OPTED_IN", message: "Customer did not opt in to AI rendering." },
        400,
        debugId
      );
    }

    // If already rendered (either via cols or job table), return success immediately
    if (hasRenderCols) {
      const status = String(quoteRow.render_status ?? "");
      const img = quoteRow.render_image_url ? String(quoteRow.render_image_url) : null;
      if (status === "rendered" && img) {
        return json(
          { ok: true, quoteLogId, skipped: true, reason: "already_rendered", status, imageUrl: img },
          200,
          debugId
        );
      }
    }

    // Ensure at least one image exists in stored input (render worker needs it)
    const input = safeJsonParse(quoteRow.input) ?? {};
    const urls: string[] = Array.isArray(input?.images) ? input.images.map((x: any) => x?.url).filter(Boolean) : [];
    if (!urls.length) {
      return json(
        { ok: false, error: "NO_IMAGES", message: "No images stored on quote log input." },
        400,
        debugId
      );
    }

    const prompt = buildRenderPromptFromQuoteRow(quoteRow);

    // Upsert into render_jobs with UNIQUE(quote_log_id) to prevent multi-attempt waste
    // If job already exists, return it.
    const existing = await db.execute(sql`
      select id, status, image_url, error
      from render_jobs
      where quote_log_id = ${quoteLogId}::uuid
      limit 1
    `);

    const ex: any = (existing as any)?.rows?.[0] ?? (Array.isArray(existing) ? (existing as any)[0] : null);

    if (ex?.id) {
      return json(
        {
          ok: true,
          quoteLogId,
          jobId: String(ex.id),
          status: String(ex.status ?? "queued"),
          imageUrl: ex.image_url ? String(ex.image_url) : null,
          error: ex.error ? String(ex.error) : null,
          alreadyQueued: true,
        },
        200,
        debugId
      );
    }

    const jobId = crypto.randomUUID();

    await db.execute(sql`
      insert into render_jobs (id, tenant_id, quote_log_id, status, prompt, created_at)
      values (${jobId}::uuid, ${tenantId}::uuid, ${quoteLogId}::uuid, 'queued', ${prompt}, now())
    `);

    // IMPORTANT:
    // On Vercel, the actual render processing should be done by a Cron-triggered route
    // (we’ll add that next after status + render domain code).
    return json(
      { ok: true, quoteLogId, jobId, status: "queued" },
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
