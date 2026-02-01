// src/lib/pcc/render/output.ts
import { sql } from "drizzle-orm";

type DbLike = { execute: (q: any) => Promise<any> };

function normalizeDbErr(err: any) {
  return {
    message: err?.message ?? String(err),
    code: err?.code ?? err?.cause?.code,
    causeMessage: err?.cause?.message,
    detail: err?.detail ?? err?.cause?.detail,
    hint: err?.hint ?? err?.cause?.hint,
  };
}

/**
 * Single source of truth:
 *   quote_logs.output.render_debug  (jsonb)
 *
 * Never writes to dedicated columns (has_render_debug/render_debug/debug_*),
 * because schema drift has made those unreliable.
 */
export async function setRenderDebug(args: {
  db: DbLike;
  quoteLogId: string;
  tenantId?: string | null;
  debug: any;
}) {
  const { db, quoteLogId, debug } = args;

  // Ensure it’s valid JSON
  const payloadObj = debug ?? {};
  const payloadStr = JSON.stringify(payloadObj);

  try {
    await db.execute(sql`
      update quote_logs
      set output = jsonb_set(
        coalesce(output, '{}'::jsonb),
        '{render_debug}',
        ${payloadStr}::jsonb,
        true
      )
      where id = ${quoteLogId}::uuid
    `);

    return { ok: true as const, where: "output.render_debug" as const };
  } catch (e: any) {
    return { ok: false as const, where: "output.render_debug" as const, error: normalizeDbErr(e) };
  }
}

/**
 * Single source of truth:
 *   quote_logs.output.render_email (jsonb)
 *
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
  const payloadStr = JSON.stringify(val ?? {});

  try {
    await db.execute(sql`
      update quote_logs
      set output = jsonb_set(
        coalesce(output, '{}'::jsonb),
        '{render_email}',
        ${payloadStr}::jsonb,
        true
      )
      where id = ${quoteLogId}::uuid
    `);

    return { ok: true as const, where: "output.render_email" as const };
  } catch (e: any) {
    return { ok: false as const, where: "output.render_email" as const, error: normalizeDbErr(e) };
  }
}