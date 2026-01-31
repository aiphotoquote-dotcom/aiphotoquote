// src/lib/pcc/render/output.ts
import { sql } from "drizzle-orm";

type DbLike = { execute: (q: any) => Promise<any> };

function normalizeDbErr(err: any) {
  return {
    message: err?.message ?? String(err),
    code: err?.code ?? err?.cause?.code,
    causeMessage: err?.cause?.message,
  };
}

function isUndefinedColumn(e: any) {
  const msg = String(e?.message ?? e?.cause?.message ?? "");
  const code = e?.code ?? e?.cause?.code;
  return code === "42703" || /column .* does not exist/i.test(msg);
}

/**
 * Best-effort: persist render debug.
 * Priority:
 * 1) Dedicated columns that already exist in your DB: render_debug + debug_* + final_prompt_prefix
 * 2) Fallback: quote_logs.output.render_debug
 *
 * NOTE: We DO NOT reference has_render_debug because your schema does not include it.
 */
export async function setRenderDebug(args: {
  db: DbLike;
  quoteLogId: string;
  tenantId?: string | null;
  debug: any;
}) {
  const { db, quoteLogId, debug } = args;

  const payload = JSON.stringify(debug ?? {});
  const renderModel = String(debug?.renderModel ?? "").trim() || null;
  const tenantStyleKey = String(debug?.tenantStyleKey ?? "").trim() || null;
  const finalPrompt = String(debug?.finalPrompt ?? "");
  const finalPromptPrefix = finalPrompt ? finalPrompt.slice(0, 240) : null;

  // 1) Try dedicated columns that exist in your DB
  try {
    await db.execute(sql`
      update quote_logs
      set
        render_debug = ${payload}::jsonb,
        debug_render_model = ${renderModel},
        debug_tenant_style_key = ${tenantStyleKey},
        final_prompt_prefix = ${finalPromptPrefix}
      where id = ${quoteLogId}::uuid
    `);
    return { ok: true as const, where: "columns" as const };
  } catch (e: any) {
    if (!isUndefinedColumn(e)) {
      return { ok: false as const, where: "columns" as const, error: normalizeDbErr(e) };
    }
  }

  // 2) Fallback to output.render_debug (portable)
  try {
    await db.execute(sql`
      update quote_logs
      set output = jsonb_set(
        coalesce(output, '{}'::jsonb),
        '{render_debug}',
        ${payload}::jsonb,
        true
      )
      where id = ${quoteLogId}::uuid
    `);
    return { ok: true as const, where: "output" as const };
  } catch (e: any) {
    return { ok: false as const, where: "output" as const, error: normalizeDbErr(e) };
  }
}

/**
 * Persist render email result in output.render_email.
 * Accepts both arg names (email/emailResult) to avoid TS drift.
 */
export async function setRenderEmailResult(args: {
  db: DbLike;
  quoteLogId: string;
  tenantId?: string | null;
  email?: any;
  emailResult?: any;
}) {
  const { db, quoteLogId } = args;
  const val = args.emailResult ?? args.email ?? null;
  const payload = JSON.stringify(val ?? {});

  try {
    await db.execute(sql`
      update quote_logs
      set output = jsonb_set(
        coalesce(output, '{}'::jsonb),
        '{render_email}',
        ${payload}::jsonb,
        true
      )
      where id = ${quoteLogId}::uuid
    `);
    return { ok: true as const };
  } catch (e: any) {
    return { ok: false as const, error: normalizeDbErr(e) };
  }
}