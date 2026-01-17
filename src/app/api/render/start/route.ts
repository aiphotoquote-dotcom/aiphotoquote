// app/api/render/start/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import OpenAI from "openai";
import crypto from "crypto";
import { put } from "@vercel/blob";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

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

// tenant_secrets: tenant_id, openai_key_enc
async function getTenantOpenAiKey(tenantId: string): Promise<string | null> {
  const r = await db.execute(
    sql`select openai_key_enc from tenant_secrets where tenant_id = ${tenantId} limit 1`
  );
  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  const enc = row?.openai_key_enc ?? null;
  if (!enc) return null;
  return decryptSecret(enc);
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

  const output = safeJsonParse(row?.output) ?? {};
  if (typeof output?.meta?.render_opt_in === "boolean") return output.meta.render_opt_in;
  if (typeof output?.output?.render_opt_in === "boolean") return output.output.render_opt_in;

  return false;
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
    return { ok: true as const, columns: false as const };
  }
}

async function storeRenderResultBestEffort(args: {
  quoteLogId: string;
  imageUrl: string | null;
  error: string | null;
  prompt: string;
}) {
  const { quoteLogId, imageUrl, error, prompt } = args;

  // 1) Try dedicated columns
  try {
    await db.execute(sql`
      update quote_logs
      set
        render_status = ${error ? "failed" : "rendered"},
        render_image_url = ${imageUrl},
        render_prompt = ${prompt},
        render_error = ${error},
        rendered_at = now()
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
  }

  // 2) Fallback: merge into output.rendering
  try {
    const r = await db.execute(sql`
      select output
      from quote_logs
      where id = ${quoteLogId}::uuid
      limit 1
    `);
    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
    const out = safeJsonParse(row?.output) ?? {};

    const next = {
      ...out,
      rendering: {
        requested: true,
        status: error ? "failed" : "rendered",
        imageUrl,
        prompt,
        error,
        renderedAt: new Date().toISOString(),
      },
    };

    await updateQuoteLogOutput(quoteLogId, next);
    return { ok: true as const, columns: false as const, merged: true as const };
  } catch (e: any) {
    return { ok: false as const, columns: false as const, dbErr: normalizeDbErr(e) };
  }
}

/**
 * IMPORTANT: clamp size to a supported OpenAI image size.
 * This is the exact issue from your screenshot (400 invalid value).
 * We hard-lock to 1024x1024 to match the stable behavior from maggioupholstery.com.
 */
const OPENAI_IMAGE_SIZE = "1024x1024" as const;

async function uploadToBlobFromBytes(args: {
  filename: string;
  bytes: Buffer;
  contentType: string;
}) {
  const { filename, bytes, contentType } = args;

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("Missing BLOB_READ_WRITE_TOKEN (Vercel Blob) env var");

  // put() accepts Buffer directly (do NOT pass Uint8Array)
  const res = await put(`renders/${filename}`, bytes, {
    access: "public",
    contentType,
    token,
  });

  return res.url;
}

async function uploadToBlobFromUrl(args: { filename: string; imageUrl: string }) {
  const { filename, imageUrl } = args;

  const r = await fetch(imageUrl);
  if (!r.ok) throw new Error(`Failed to download rendered image (HTTP ${r.status})`);

  const contentType = r.headers.get("content-type") || "image/png";
  const arr = await r.arrayBuffer();
  const bytes = Buffer.from(arr);

  return uploadToBlobFromBytes({ filename, bytes, contentType });
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

    // Tenant-level gating (best effort)
    const enabled = await isTenantRenderingEnabled(tenantId);
    if (enabled !== true) {
      return json(
        {
          ok: false,
          error: "RENDERING_DISABLED",
          message:
            enabled === false
              ? "Tenant disabled AI rendering."
              : "Tenant rendering setting unknown.",
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

    if (String(quoteRow.tenant_id) !== String(tenantId)) {
      return json({ ok: false, error: "TENANT_MISMATCH" }, 403, debugId);
    }

    // Customer opt-in required
    const optIn = pickRenderOptInFromRecord({ row: quoteRow, renderingCols });
    if (!optIn) {
      return json(
        { ok: false, error: "NOT_OPTED_IN", message: "Customer did not opt in to AI rendering." },
        400,
        debugId
      );
    }

    // Pull images + context from stored input
    const input = safeJsonParse(quoteRow.input) ?? {};
    const images: string[] = Array.isArray(input?.images)
      ? input.images.map((x: any) => x?.url).filter(Boolean)
      : [];

    if (!images.length) {
      return json(
        { ok: false, error: "NO_IMAGES", message: "No images stored on quote log input." },
        400,
        debugId
      );
    }

    const customerCtx = input?.customer_context ?? {};
    const notes = (customerCtx?.notes ?? "").toString().trim();
    const category = (customerCtx?.category ?? "").toString().trim();
    const serviceType = (customerCtx?.service_type ?? "").toString().trim();

    const openAiKey = await getTenantOpenAiKey(tenantId);
    if (!openAiKey) return json({ ok: false, error: "OPENAI_KEY_MISSING" }, 500, debugId);

    const prompt = [
      "Create a realistic concept 'after' rendering of the finished upholstery/service outcome.",
      "This is a second-step visual preview. Do NOT provide pricing. Do NOT provide text overlays.",
      "Preserve the subject and original photo perspective as much as possible.",
      "Output should look like a professional shop result, clean and plausible.",
      "",
      "IMPORTANT: output must be a single realistic image.",
      category ? `Category: ${category}` : "",
      serviceType ? `Service type: ${serviceType}` : "",
      notes ? `Customer notes: ${notes}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const queuedMark = await markRenderQueuedBestEffort({ quoteLogId, prompt });
    if (queuedMark.ok === false) {
      return json(
        { ok: false, error: "DB_WRITE_FAILED", stage: "mark_queued", queuedMark },
        500,
        debugId
      );
    }

    const openai = new OpenAI({ apiKey: openAiKey });

    let finalImageUrl: string | null = null;
    let renderError: string | null = null;

    try {
      const img = await openai.images.generate({
        model: "gpt-image-1",
        prompt,
        // 🔒 Clamp to supported size to avoid the 400 you screenshotted
        size: OPENAI_IMAGE_SIZE,
      } as any);

      const first: any = (img as any)?.data?.[0] ?? null;
      const url = first?.url ? String(first.url) : null;
      const b64 = first?.b64_json ? String(first.b64_json) : null;

      const filename = `render-${quoteLogId}.png`;

      if (b64) {
        const bytes = Buffer.from(b64, "base64");
        finalImageUrl = await uploadToBlobFromBytes({
          filename,
          bytes,
          contentType: "image/png",
        });
      } else if (url) {
        // If OpenAI returns a URL, download -> upload to Blob (stable URL)
        finalImageUrl = await uploadToBlobFromUrl({ filename, imageUrl: url });
      } else {
        throw new Error("OpenAI image response missing url/b64_json");
      }
    } catch (e: any) {
      renderError = e?.message ?? "Render generation failed.";
    }

    const stored = await storeRenderResultBestEffort({
      quoteLogId,
      imageUrl: finalImageUrl,
      error: renderError,
      prompt,
    });

    if (renderError) {
      return json(
        {
          ok: false,
          error: "RENDER_FAILED",
          message: renderError,
          quoteLogId,
          stored,
          durationMs: Date.now() - startedAt,
        },
        500,
        debugId
      );
    }

    return json(
      {
        ok: true,
        quoteLogId,
        imageUrl: finalImageUrl,
        stored,
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
