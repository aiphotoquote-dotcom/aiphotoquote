import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import OpenAI from "openai";
import crypto from "crypto";
import { put } from "@vercel/blob";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

import { sendEmail } from "@/lib/email";
import { buildRenderReadyEmail } from "@/lib/email/templates/renderReady";

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

// ---- DB helpers ----

async function getTenantBySlug(tenantSlug: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug)).limit(1);
  return rows[0] ?? null;
}

// tenant_secrets: tenant_id, openai_key_enc
async function getTenantOpenAiKey(tenantId: string): Promise<string | null> {
  const r = await db.execute(sql`select openai_key_enc from tenant_secrets where tenant_id = ${tenantId} limit 1`);
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

// tenant_settings: business_name, lead_to_email, resend_from_email
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
    if (!isUndefinedColumn) return { ok: false as const, columns: false as const, dbErr: normalizeDbErr(e) };
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
    if (!isUndefinedColumn) return { ok: false as const, columns: false as const, dbErr: normalizeDbErr(e) };
  }

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

// NEW: provider-agnostic email send (Standard mode via Resend adapter)
async function sendRenderEmailsViaAbstraction(args: {
  tenantId: string;
  tenantSlug: string;
  quoteLogId: string;
  customerEmail: string | null;
  renderImageUrl: string;
}) {
  const { businessName, leadToEmail, resendFromEmail } = await getTenantEmailSettings(args.tenantId);
  const resendKeyPresent = !!process.env.RESEND_API_KEY?.trim();

  const configured = Boolean(resendKeyPresent && businessName && leadToEmail && resendFromEmail);

  const result = {
    configured,
    lead: { attempted: false, sent: false, id: null as string | null, error: null as string | null },
    customer: { attempted: false, sent: false, id: null as string | null, error: null as string | null },
    missingEnv: { RESEND_API_KEY: !resendKeyPresent },
    missingTenant: {
      business_name: !businessName,
      lead_to_email: !leadToEmail,
      resend_from_email: !resendFromEmail,
    },
  };

  if (!configured) return result;

  const tpl = buildRenderReadyEmail({
    businessName: businessName!,
    tenantSlug: args.tenantSlug,
    quoteLogId: args.quoteLogId,
    renderImageUrl: args.renderImageUrl,
  });

  // Lead
  try {
    result.lead.attempted = true;
    const r = await sendEmail({
      tenantId: args.tenantId,
      context: { type: "lead_render", quoteLogId: args.quoteLogId },
      message: {
        from: resendFromEmail!,
        to: [leadToEmail!],
        subject: tpl.subjectLead,
        html: tpl.html,
      },
    });

    if (!r.ok) throw new Error(r.error || "Send failed");
    result.lead.sent = true;
    result.lead.id = r.providerMessageId ?? null;
  } catch (e: any) {
    result.lead.error = e?.message ?? String(e);
  }

  // Customer
  if (args.customerEmail) {
    try {
      result.customer.attempted = true;
      const r = await sendEmail({
        tenantId: args.tenantId,
        context: { type: "customer_render", quoteLogId: args.quoteLogId },
        message: {
          from: resendFromEmail!,
          to: [args.customerEmail],
          subject: tpl.subjectCustomer,
          html: tpl.html,
        },
      });

      if (!r.ok) throw new Error(r.error || "Send failed");
      result.customer.sent = true;
      result.customer.id = r.providerMessageId ?? null;
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
    if (String(quoteRow.tenant_id) !== String(tenantId)) {
      return json({ ok: false, error: "TENANT_MISMATCH" }, 403, debugId);
    }

    // Idempotency
    if (renderingCols) {
      const status = String(quoteRow.render_status ?? "");
      const url = quoteRow.render_image_url ? String(quoteRow.render_image_url) : null;
      if (status === "rendered" && url) {
        return json(
          { ok: true, quoteLogId, skipped: true, reason: "already_rendered", imageUrl: url, durationMs: Date.now() - startedAt },
          200,
          debugId
        );
      }
      if (status === "queued" && !url) {
        return json(
          { ok: true, quoteLogId, skipped: true, reason: "already_queued", durationMs: Date.now() - startedAt },
          200,
          debugId
        );
      }
    } else {
      const out = safeJsonParse(quoteRow.output) ?? {};
      const r = out?.rendering ?? null;
      if (r?.status === "rendered" && r?.imageUrl) {
        return json(
          { ok: true, quoteLogId, skipped: true, reason: "already_rendered", imageUrl: String(r.imageUrl), durationMs: Date.now() - startedAt },
          200,
          debugId
        );
      }
      if (r?.status === "queued") {
        return json(
          { ok: true, quoteLogId, skipped: true, reason: "already_queued", durationMs: Date.now() - startedAt },
          200,
          debugId
        );
      }
    }

    const optIn = pickRenderOptInFromRecord({ row: quoteRow, renderingCols });
    if (!optIn) {
      return json({ ok: false, error: "NOT_OPTED_IN", message: "Customer did not opt in to AI rendering." }, 400, debugId);
    }

    // Pull images + context
    const input = safeJsonParse(quoteRow.input) ?? {};
    const images: string[] = Array.isArray(input?.images) ? input.images.map((x: any) => x?.url).filter(Boolean) : [];
    if (!images.length) {
      return json({ ok: false, error: "NO_IMAGES", message: "No images stored on quote log input." }, 400, debugId);
    }

    const customerCtx = input?.customer_context ?? {};
    const notes = (customerCtx?.notes ?? "").toString().trim();
    const category = (customerCtx?.category ?? "").toString().trim();
    const serviceType = (customerCtx?.service_type ?? "").toString().trim();
    const customerEmail = customerCtx?.email ? String(customerCtx.email).trim() : null;

    const openAiKey = await getTenantOpenAiKey(tenantId);
    if (!openAiKey) return json({ ok: false, error: "OPENAI_KEY_MISSING" }, 500, debugId);

    const prompt = [
      "Create a realistic concept 'after' rendering of the finished upholstery/service outcome.",
      "This is a second-step visual preview. Do NOT provide pricing. Do NOT provide text overlays.",
      "Output should look like a professional shop result, clean and plausible.",
      "Preserve the subject and original photo perspective as much as possible.",
      category ? `Category: ${category}` : "",
      serviceType ? `Service type: ${serviceType}` : "",
      notes ? `Customer notes: ${notes}` : "",
    ].filter(Boolean).join("\n");

    const queuedMark = await markRenderQueuedBestEffort({ quoteLogId, prompt });

    const openai = new OpenAI({ apiKey: openAiKey });

    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    if (!blobToken) {
      return json({ ok: false, error: "BLOB_TOKEN_MISSING", message: "Missing BLOB_READ_WRITE_TOKEN env var." }, 500, debugId);
    }

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

      let bytes: Buffer | null = null;
      let contentType = "image/png";

      if (b64) {
        bytes = Buffer.from(b64, "base64");
        contentType = "image/png";
      } else if (url) {
        const dl = await fetch(url);
        if (!dl.ok) throw new Error(`Failed to download render (HTTP ${dl.status})`);
        const ab = await dl.arrayBuffer();
        bytes = Buffer.from(ab);
        contentType = dl.headers.get("content-type") || "image/png";
      } else {
        throw new Error("OpenAI image response missing url/b64_json");
      }

      const pathname = `renders/render-${quoteLogId}.png`;
      const putRes = await put(pathname, bytes, { access: "public", contentType, token: blobToken });
      finalImageUrl = putRes.url;
    } catch (e: any) {
      renderError = e?.message ?? "Render generation failed.";
    }

    const stored = await storeRenderResultBestEffort({
      quoteLogId,
      imageUrl: finalImageUrl,
      error: renderError,
      prompt,
    });

    // NEW: emails via abstraction
    let renderEmail: any = null;
    if (!renderError && finalImageUrl) {
      try {
        renderEmail = await sendRenderEmailsViaAbstraction({
          tenantId,
          tenantSlug,
          quoteLogId,
          customerEmail,
          renderImageUrl: finalImageUrl,
        });

        // Persist into output JSON (best effort)
        try {
          const cur = safeJsonParse(quoteRow.output) ?? {};
          const next = { ...cur, email: { ...(cur?.email ?? {}), render: renderEmail } };
          await updateQuoteLogOutput(quoteLogId, next);
        } catch {
          // ignore
        }
      } catch (e: any) {
        renderEmail = { configured: false, error: e?.message ?? String(e) };
      }
    }

    if (renderError) {
      return json(
        { ok: false, error: "RENDER_FAILED", message: renderError, quoteLogId, stored, queuedMark, durationMs: Date.now() - startedAt },
        500,
        debugId
      );
    }

    return json(
      { ok: true, quoteLogId, imageUrl: finalImageUrl, stored, queuedMark, renderEmail, durationMs: Date.now() - startedAt },
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