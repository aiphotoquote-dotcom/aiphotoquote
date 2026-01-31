// src/lib/pcc/render/output.ts
import { sql } from "drizzle-orm";

/**
 * Render output/debug writer.
 *
 * Goal:
 * - If quote_logs has dedicated render debug columns, write them.
 * - If not, ALWAYS persist debug into quote_logs.output.render_debug (jsonb merge).
 *
 * This removes ambiguity where "debug is enabled" but nothing is stored.
 */

type DbLike = { execute: (q: any) => Promise<any> };

function normalizeDbErr(err: any) {
  return {
    name: err?.name,
    message: err?.message ?? String(err),
    code: err?.code ?? err?.cause?.code,
    detail: err?.detail ?? err?.cause?.detail,
    hint: err?.hint ?? err?.cause?.hint,
    where: err?.where ?? err?.cause?.where,
  };
}

function isUndefinedColumnErr(err: any) {
  const code = err?.code ?? err?.cause?.code;
  const msg = String(err?.message ?? err?.cause?.message ?? "");
  return code === "42703" || /column .* does not exist/i.test(msg);
}

function asString(v: any) {
  const s = String(v ?? "").trim();
  return s;
}

/**
 * Lowest-level helper: merge into quote_logs.output at a json path.
 * (jsonb_set create_missing=true)
 */
export async function setQuoteOutputPath(args: {
  db: DbLike;
  quoteLogId: string;
  tenantId?: string | null;
  path: string[]; // e.g. ["render_debug"] or ["pcc","render","debug"]
  value: any;
}) {
  const { db, quoteLogId, tenantId, path, value } = args;

  const pgPath = `{${path.map((p) => String(p).replace(/"/g, "")).join(",")}}`;
  const payload = JSON.stringify(value ?? null);

  const tenantClause = tenantId ? sql`and tenant_id = ${tenantId}::uuid` : sql``;

  await db.execute(sql`
    update quote_logs
    set output = jsonb_set(
      coalesce(output, '{}'::jsonb),
      ${pgPath}::text[],
      ${payload}::jsonb,
      true
    )
    where id = ${quoteLogId}::uuid
    ${tenantClause}
  `);

  return { ok: true as const };
}

/**
 * Write render debug in the most durable way possible:
 * 1) Try dedicated columns (if they exist).
 * 2) Always also merge into output.render_debug (jsonb).
 */
export async function setRenderDebug(args: {
  db: DbLike;
  quoteLogId: string;
  tenantId?: string | null;
  debug: any;
}) {
  const { db, quoteLogId, tenantId, debug } = args;

  const renderModel =
    asString(debug?.render_model) ||
    asString(debug?.renderModel) ||
    asString(debug?.model) ||
    "";

  const tenantStyleKey =
    asString(debug?.tenant_style_key) ||
    asString(debug?.tenantStyleKey) ||
    asString(debug?.style_key) ||
    "";

  const finalPromptPrefix =
    asString(debug?.final_prompt_prefix) ||
    asString(debug?.finalPromptPrefix) ||
    asString(debug?.prompt_prefix) ||
    "";

  // Always merge into output (this is the fallback + proof store)
  await setQuoteOutputPath({
    db,
    quoteLogId,
    tenantId: tenantId ?? null,
    path: ["render_debug"],
    value: {
      ...(typeof debug === "object" && debug ? debug : { raw: debug }),
      render_model: renderModel || undefined,
      tenant_style_key: tenantStyleKey || undefined,
      final_prompt_prefix: finalPromptPrefix || undefined,
      written_at: new Date().toISOString(),
    },
  });

  // Best-effort: also update dedicated columns if they exist
  try {
    const payload = JSON.stringify(debug ?? {});
    const tenantClause = tenantId ? sql`and tenant_id = ${tenantId}::uuid` : sql``;

    await db.execute(sql`
      update quote_logs
      set
        has_render_debug = true,
        render_debug = ${payload}::jsonb,
        debug_render_model = ${renderModel || null},
        debug_tenant_style_key = ${tenantStyleKey || null},
        final_prompt_prefix = ${finalPromptPrefix || null},
        updated_at = coalesce(updated_at, now())
      where id = ${quoteLogId}::uuid
      ${tenantClause}
    `);

    return { ok: true as const, wroteColumns: true as const };
  } catch (e: any) {
    if (!isUndefinedColumnErr(e)) {
      return { ok: false as const, wroteColumns: false as const, error: normalizeDbErr(e) };
    }
    // Columns don't exist — that's fine; output json is our proof store.
    return { ok: true as const, wroteColumns: false as const };
  }
}

/**
 * Store render email result (same philosophy: prefer columns if present, always merge JSON).
 */
export async function setRenderEmailResult(args: {
  db: DbLike;
  quoteLogId: string;
  tenantId?: string | null;
  emailResult: any;
}) {
  const { db, quoteLogId, tenantId, emailResult } = args;

  await setQuoteOutputPath({
    db,
    quoteLogId,
    tenantId: tenantId ?? null,
    path: ["render_email_result"],
    value: { ...(typeof emailResult === "object" && emailResult ? emailResult : { raw: emailResult }), written_at: new Date().toISOString() },
  });

  // Optional: if you later add a render_email_result column, we can extend this similarly.
  return { ok: true as const };
}