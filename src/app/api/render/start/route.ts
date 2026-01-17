// app/api/render/start/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import OpenAI from "openai";
import crypto from "crypto";

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

function normalizeErr(err: any) {
  return {
    name: err?.name,
    message: err?.message ?? String(err),
    code: err?.code,
    status: err?.status,
    causeMessage: err?.cause?.message,
    causeCode: err?.cause?.code,
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
  } catch {
    // No dedicated columns; caller will use output.rendering fallback.
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
  const renderedAt = new Date().toISOString();

  // Try dedicated columns first
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
  } catch {
    // Fallback into output.rendering
  }

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
      renderedAt,
    },
  };

  await updateQuoteLogOutput(quoteLogId, next);
  return { ok: true as const, columns: false as const, merged: true as const };
}

function getBlobToken(): string | null {
  // Support both env names people commonly use
  return (
    process.env.BLOB_READ_WRITE_TOKEN ??
    process.env.VERCEL_BLOB_READ_WRITE_TOKEN ??
    process.env.VERCEL_BLOB_TOKEN ??
    null
  );
}

function looksLikeHtml(s: string) {
  const t = s.trim().slice(0, 500).toLowerCase();
  return t.startsWith("<!doctype html") || t.startsWith("<html") || t.includes("<head");
}

function looksLikeCloudflare(s: string) {
  const t = s.toLowerCase();
  return t.includes("cloudflare") || t.includes("attention required") || t.includes("cf-ray");
}

async function uploadToVercelBlob(args: {
  filename: string;
  bytes: Buffer;
  contentType: string;
}) {
  const token = getBlobToken();
  if (!token) {
    throw new Error("Missing BLOB_READ_WRITE_TOKEN (or VERCEL_BLOB_READ_WRITE_TOKEN) env var");
  }

  // Lazy import so build doesn’t fail if not installed locally yet.
  const mod: any = await import("@vercel/blob");
  const put: any = mod.put;

  const res = await put(`renders/${args.filename}`, args.bytes, {
    access: "public",
    contentType: args.contentType,
    token,
  });

  const url = res?.url ? String(res.url) : null;
  if (!url) throw new Error("Blob put did not return a url");
  return url;
}

export async function GET() {
  return json(
    { ok: false, error: "METHOD_NOT_ALLOWED", message: "Use POST for /api/render/start" },
    405
  );
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

    // Tenant gating
    const enabled = await isTenantRenderingEnabled(tenantId);
    if (enabled !== true) {
      return json(
        {
          ok: false,
          error: "RENDERING_DISABLED",
          message:
            enabled === false ? "Tenant disabled AI rendering." : "Tenant rendering setting unknown.",
        },
        400,
        debugId
      );
    }

    // Load quote log (new columns first; fall back)
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

    // Single-attempt rule:
    // If already rendered OR already attempted (failed/queued), do not auto-burn tokens.
    const existingOut = safeJsonParse(quoteRow.output) ?? {};
    const existingRendering = existingOut?.rendering ?? null;

    const alreadyRendered =
      (renderingCols && typeof quoteRow.render_image_url === "string" && quoteRow.render_image_url) ||
      (typeof existingRendering?.imageUrl === "string" && existingRendering.imageUrl);

    if (alreadyRendered) {
      return json(
        {
          ok: true,
          already: true,
          quoteLogId,
          imageUrl: renderingCols ? quoteRow.render_image_url : existingRendering.imageUrl,
          durationMs: Date.now() - startedAt,
        },
        200,
        debugId
      );
    }

    const alreadyAttemptedStatus =
      (renderingCols && typeof quoteRow.render_status === "string" && quoteRow.render_status) ||
      (typeof existingRendering?.status === "string" && existingRendering.status) ||
      null;

    if (alreadyAttemptedStatus && alreadyAttemptedStatus !== "rendered") {
      return json(
        {
          ok: false,
          error: "ALREADY_ATTEMPTED",
          message:
            "Rendering was already attempted for this quote. Use the Retry button to try again later.",
          status: alreadyAttemptedStatus,
          durationMs: Date.now() - startedAt,
        },
        409,
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
      "This is a second-step visual preview.",
      "Do NOT provide pricing. Do NOT provide text overlays. Do NOT add watermarks or logos.",
      "Preserve the subject and original photo perspective as much as possible.",
      "Output should look like a professional shop result, clean and plausible.",
      category ? `Category: ${category}` : "",
      serviceType ? `Service type: ${serviceType}` : "",
      notes ? `Customer notes: ${notes}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // mark queued (best-effort)
    const queuedMark = await markRenderQueuedBestEffort({ quoteLogId, prompt });

    // Also set fallback output.rendering to queued so UI can show progress even without columns
    if (!queuedMark.columns) {
      const out = safeJsonParse(quoteRow.output) ?? {};
      const next = {
        ...out,
        rendering: {
          requested: true,
          status: "queued",
          imageUrl: null,
          prompt,
          error: null,
          queuedAt: new Date().toISOString(),
        },
      };
      await updateQuoteLogOutput(quoteLogId, next);
    }

    const openai = new OpenAI({ apiKey: openAiKey });

    let finalImageUrl: string | null = null;
    let renderError: string | null = null;

    try {
      // IMPORTANT:
      // - Use b64 to avoid extra fetch() of an OpenAI-hosted URL
      // - Keep size modest to reduce payloads
      const img: any = await openai.images.generate({
        model: "gpt-image-1",
        prompt,
        size: "1024x1024",
        response_format: "b64_json",
      } as any);

      const first: any = img?.data?.[0] ?? null;
      const b64 = first?.b64_json ? String(first.b64_json) : null;
      const url = first?.url ? String(first.url) : null;

      if (b64) {
        // Guard: sometimes upstream failures surface as HTML-ish strings (rare but real)
        if (looksLikeHtml(b64) || looksLikeCloudflare(b64)) {
          throw new Error("Upstream blocked rendering (Cloudflare/HTML response). Try again later.");
        }

        const bytes = Buffer.from(b64, "base64");

        // Guard: must look like a PNG/JPEG (very cheap signature checks)
        const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e;
        const isJpg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
        if (!isPng && !isJpg) {
          throw new Error("Render returned non-image payload. Try again later.");
        }

        const contentType = isJpg ? "image/jpeg" : "image/png";
        const filename = `render-${quoteLogId}.${isJpg ? "jpg" : "png"}`;

        // Upload directly to Vercel Blob (server-side, no relative URL parsing)
        finalImageUrl = await uploadToVercelBlob({ filename, bytes, contentType });
      } else if (url) {
        // Fallback: if the API returns a URL, keep it (no blob upload attempt here)
        // This avoids the “Failed to parse URL from /api/blob/upload” issue entirely.
        if (looksLikeHtml(url) || looksLikeCloudflare(url)) {
          throw new Error("Upstream blocked rendering (Cloudflare). Try again later.");
        }
        finalImageUrl = url;
      } else {
        throw new Error("OpenAI image response missing b64_json/url");
      }
    } catch (e: any) {
      // Never leak raw HTML to the UI
      const msg = e?.message ?? "Render generation failed.";

      if (typeof msg === "string" && looksLikeHtml(msg)) {
        renderError = "Upstream blocked rendering (HTML/Cloudflare). Try again later.";
      } else if (typeof msg === "string" && looksLikeCloudflare(msg)) {
        renderError = "Upstream blocked rendering (Cloudflare). Try again later.";
      } else {
        // Keep it short + user-safe
        renderError = msg.length > 220 ? msg.slice(0, 220) + "…" : msg;
      }
    }

    // Store result
    await storeRenderResultBestEffort({
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
          durationMs: Date.now() - startedAt,
        },
        502,
        debugId
      );
    }

    return json(
      {
        ok: true,
        quoteLogId,
        imageUrl: finalImageUrl,
        durationMs: Date.now() - startedAt,
      },
      200,
      debugId
    );
  } catch (err: any) {
    return json(
      {
        ok: false,
        error: "REQUEST_FAILED",
        message: err?.message ?? String(err),
        server_debug: normalizeErr(err),
      },
      500,
      crypto.randomBytes(6).toString("hex")
    );
  }
}
