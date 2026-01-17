import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import OpenAI from "openai";
import crypto from "crypto";
import { put } from "@vercel/blob";
import { Resend } from "resend";

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

async function getTenantOpenAiKey(tenantId: string): Promise<string | null> {
  const r = await db.execute(sql`select openai_key_enc from tenant_secrets where tenant_id = ${tenantId} limit 1`);
  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  const enc = row?.openai_key_enc ?? null;
  if (!enc) return null;
  return decryptSecret(enc);
}

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
  if (typeof output?.rendering?.requested === "boolean") return output.rendering.requested;

  return false;
}

function getExistingRenderFromOutput(row: any) {
  const out = safeJsonParse(row?.output) ?? {};
  const rendering = out?.rendering ?? null;
  const status = typeof rendering?.status === "string" ? rendering.status : null;
  const imageUrl = typeof rendering?.imageUrl === "string" ? rendering.imageUrl : null;
  const error = typeof rendering?.error === "string" ? rendering.error : null;
  return { status, imageUrl, error, raw: rendering };
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
  const renderedAtIso = new Date().toISOString();

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

  // fallback merge into output.rendering
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
        renderedAt: renderedAtIso,
      },
    };

    await updateQuoteLogOutput(quoteLogId, next);
    return { ok: true as const, columns: false as const, merged: true as const };
  } catch (e: any) {
    return { ok: false as const, columns: false as const, dbErr: normalizeDbErr(e) };
  }
}

function safeFilename(s: string) {
  return (s || "render.png")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 160);
}

function esc(s: unknown) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderRenderEmailHTML(args: {
  businessName: string;
  quoteLogId: string;
  imageUrl: string;
}) {
  const { businessName, quoteLogId, imageUrl } = args;

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.4;color:#111;">
    <h2 style="margin:0 0 8px;">AI Rendering Ready</h2>
    <div style="margin:0 0 12px;color:#374151;">
      <div><b>Quote ID</b>: ${esc(quoteLogId)}</div>
    </div>

    <div style="margin:14px 0;">
      <img src="${esc(imageUrl)}" alt="AI render" style="max-width:560px;width:100%;border-radius:10px;border:1px solid #e5e7eb"/>
    </div>

    <p style="color:#6b7280;margin-top:14px;">
      — ${esc(businessName)}
    </p>
  </div>`;
}

async function getTenantEmailSettings(tenantId: string) {
  const r = await db.execute(sql`
    select business_name, lead_to_email, resend_from_email
    from tenant_settings
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);
  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

  return {
    businessName: row?.business_name ?? null,
    leadToEmail: row?.lead_to_email ?? null,
    resendFromEmail: row?.resend_from_email ?? null,
  };
}

async function sendRenderEmailsBestEffort(args: {
  tenantSlug: string;
  tenantId: string;
  quoteLogId: string;
  customerEmail: string | null;
  imageUrl: string;
}) {
  const resendKey = process.env.RESEND_API_KEY || "";
  const settings = await getTenantEmailSettings(args.tenantId);

  const result = {
    configured: Boolean(resendKey && settings.businessName && settings.leadToEmail && settings.resendFromEmail),
    lead: { attempted: false, sent: false, id: null as string | null, error: null as string | null },
    customer: { attempted: false, sent: false, id: null as string | null, error: null as string | null },
    missingEnv: { RESEND_API_KEY: !resendKey },
    missingTenant: {
      business_name: !settings.businessName,
      lead_to_email: !settings.leadToEmail,
      resend_from_email: !settings.resendFromEmail,
    },
  };

  if (!result.configured) return result;

  const resend = new Resend(resendKey);
  const html = renderRenderEmailHTML({
    businessName: settings.businessName!,
    quoteLogId: args.quoteLogId,
    imageUrl: args.imageUrl,
  });

  // lead
  try {
    result.lead.attempted = true;
    const leadRes = await resend.emails.send({
      from: settings.resendFromEmail!,
      to: [settings.leadToEmail!],
      subject: `AI rendering ready — ${args.quoteLogId}`,
      html,
    });
    const leadId = (leadRes as any)?.data?.id ?? null;
    if ((leadRes as any)?.error) throw new Error((leadRes as any).error?.message ?? "Resend error");
    result.lead.sent = true;
    result.lead.id = leadId;
  } catch (e: any) {
    result.lead.error = e?.message ?? String(e);
  }

  // customer
  if (args.customerEmail) {
    try {
      result.customer.attempted = true;
      const custRes = await resend.emails.send({
        from: settings.resendFromEmail!,
        to: [args.customerEmail],
        subject: `Your rendering preview is ready — Quote ${args.quoteLogId}`,
        html,
      });
      const custId = (custRes as any)?.data?.id ?? null;
      if ((custRes as any)?.error) throw new Error((custRes as any).error?.message ?? "Resend error");
      result.customer.sent = true;
      result.customer.id = custId;
    } catch (e: any) {
      result.customer.error = e?.message ?? String(e);
    }
  } else {
    result.customer.error = "No customer email provided; skipping customer render email.";
  }

  return result;
}

export async function POST(req: Request) {
  const debugId = crypto.randomBytes(6).toString("hex");
  const startedAt = Date.now();

  try {
    const raw = await req.json().catch(() => null);
    const parsed = Req.safeParse(raw);
    if (!parsed.success) {
      return json({ ok: false, error: "BAD_REQUEST_VALIDATION", issues: parsed.error.issues, received: raw }, 400, debugId);
    }

    const { tenantSlug, quoteLogId } = parsed.data;

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return json({ ok: false, error: "TENANT_NOT_FOUND" }, 404, debugId);
    const tenantId = (tenant as any).id as string;

    // tenant must allow rendering
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

    // load quote log, tolerate schema drift
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

    // idempotent: if already rendered, return existing
    if (renderingCols) {
      const st = String(quoteRow.render_status ?? "");
      const existing = quoteRow.render_image_url ? String(quoteRow.render_image_url) : null;
      if (st === "rendered" && existing) {
        return json({ ok: true, quoteLogId, skipped: true, reason: "already_rendered", imageUrl: existing, durationMs: Date.now() - startedAt }, 200, debugId);
      }
      if (st === "queued") {
        return json({ ok: true, quoteLogId, skipped: true, reason: "already_queued", durationMs: Date.now() - startedAt }, 200, debugId);
      }
    } else {
      const existing = getExistingRenderFromOutput(quoteRow);
      if (existing.status === "rendered" && existing.imageUrl) {
        return json({ ok: true, quoteLogId, skipped: true, reason: "already_rendered", imageUrl: existing.imageUrl, durationMs: Date.now() - startedAt }, 200, debugId);
      }
      if (existing.status === "queued") {
        return json({ ok: true, quoteLogId, skipped: true, reason: "already_queued", durationMs: Date.now() - startedAt }, 200, debugId);
      }
    }

    // customer must have opted in
    const optIn = pickRenderOptInFromRecord({ row: quoteRow, renderingCols });
    if (!optIn) {
      return json({ ok: false, error: "NOT_OPTED_IN", message: "Customer did not opt in to AI rendering." }, 400, debugId);
    }

    const input = safeJsonParse(quoteRow.input) ?? {};
    const images: string[] = Array.isArray(input?.images)
      ? input.images.map((x: any) => x?.url).filter(Boolean)
      : [];

    if (!images.length) {
      return json({ ok: false, error: "NO_IMAGES", message: "No images stored on quote log input." }, 400, debugId);
    }

    const customerCtx = input?.customer_context ?? {};
    const customerEmail = typeof customerCtx?.email === "string" ? customerCtx.email : null;

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
      category ? `Category: ${category}` : "",
      serviceType ? `Service type: ${serviceType}` : "",
      notes ? `Customer notes: ${notes}` : "",
    ].filter(Boolean).join("\n");

    // mark queued (best-effort)
    const queuedMark = await markRenderQueuedBestEffort({ quoteLogId, prompt });

    const openai = new OpenAI({ apiKey: openAiKey });

    let finalImageUrl: string | null = null;
    let renderError: string | null = null;

    try {
      const img = await openai.images.generate({
        model: "gpt-image-1",
        prompt,
        size: "1024x1024",
      } as any);

      const first: any = (img as any)?.data?.[0] ?? null;
      const url = first?.url ? String(first.url) : null;
      const b64 = first?.b64_json ? String(first.b64_json) : null;

      // Prefer storing into Vercel Blob so the SaaS has a stable asset
      const blobToken = process.env.BLOB_READ_WRITE_TOKEN || "";

      if (!blobToken && url) {
        // No blob token configured; return OpenAI URL (still better than failing)
        finalImageUrl = url;
      } else {
        // We must have BLOB token to persist
        if (!blobToken) throw new Error("Missing BLOB_READ_WRITE_TOKEN (Vercel Blob) env var");

        const filename = safeFilename(`render-${quoteLogId}.png`);
        const pathname = `renders/${filename}`;

        if (b64) {
          const buf = Buffer.from(b64, "base64");
          const putRes = await put(pathname, buf, {
            access: "public",
            contentType: "image/png",
            token: blobToken,
          });
          finalImageUrl = putRes.url;
        } else if (url) {
          // download and re-put
          const dl = await fetch(url);
          if (!dl.ok) throw new Error(`Failed to download OpenAI render (HTTP ${dl.status})`);
          const arr = await dl.arrayBuffer();
          const buf = Buffer.from(arr);
          const contentType = dl.headers.get("content-type") || "image/png";

          const putRes = await put(pathname, buf, {
            access: "public",
            contentType,
            token: blobToken,
          });
          finalImageUrl = putRes.url;
        } else {
          throw new Error("OpenAI image response missing url/b64_json");
        }
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

    // if render succeeded, send render emails best-effort
    let email: any = null;
    if (!renderError && finalImageUrl) {
      try {
        email = await sendRenderEmailsBestEffort({
          tenantSlug,
          tenantId,
          quoteLogId,
          customerEmail,
          imageUrl: finalImageUrl,
        });
      } catch (e: any) {
        email = { ok: false, error: e?.message ?? String(e) };
      }

      // also mirror into output JSON so admin UI can show it even if render_* cols don’t exist
      try {
        const r = await db.execute(sql`select output from quote_logs where id = ${quoteLogId}::uuid limit 1`);
        const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
        const out = safeJsonParse(row?.output) ?? {};
        const next = {
          ...out,
          rendering: {
            ...(out.rendering ?? {}),
            requested: true,
            status: "rendered",
            imageUrl: finalImageUrl,
          },
          render_email: email,
        };
        await updateQuoteLogOutput(quoteLogId, next);
      } catch {
        // ignore
      }
    }

    if (renderError) {
      return json(
        {
          ok: false,
          error: "RENDER_FAILED",
          message: renderError,
          quoteLogId,
          stored,
          queuedMark,
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
        queuedMark,
        email,
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
