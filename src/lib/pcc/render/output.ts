// src/lib/pcc/render/output.ts
import { sql } from "drizzle-orm";

/**
 * Minimal DB shape we need (your `db` from "@/lib/db/client" already matches this).
 */
type DbExec = {
  execute: (q: any) => Promise<any>;
};

/**
 * Safely sets a nested key under quote_logs.output using jsonb_set,
 * preventing overwrites of other output fields.
 *
 * Example path: ["render_debug"] or ["render_email"]
 */
export async function setQuoteOutputPath(args: {
  db: DbExec;
  quoteLogId: string;
  tenantId: string;
  path: string[];
  value: unknown;
}) {
  const { db, quoteLogId, tenantId, path, value } = args;

  // Postgres jsonb path literal: '{a,b,c}'
  const pgPath = `{${path.map((p) => String(p).replace(/[{}"]/g, "")).join(",")}}`;

  await db.execute(sql`
    update quote_logs
    set output = jsonb_set(
      coalesce(output, '{}'::jsonb),
      ${pgPath}::text[],
      ${JSON.stringify(value)}::jsonb,
      true
    )
    where id = ${quoteLogId}::uuid
      and tenant_id = ${tenantId}::uuid
  `);
}

/**
 * Convenience: attach render_debug payload.
 */
export async function setRenderDebug(args: {
  db: DbExec;
  quoteLogId: string;
  tenantId: string;
  debug: unknown;
}) {
  return setQuoteOutputPath({
    db: args.db,
    quoteLogId: args.quoteLogId,
    tenantId: args.tenantId,
    path: ["render_debug"],
    value: args.debug,
  });
}

/**
 * Convenience: attach render_email payload.
 */
export async function setRenderEmailResult(args: {
  db: DbExec;
  quoteLogId: string;
  tenantId: string;
  email: unknown;
}) {
  return setQuoteOutputPath({
    db: args.db,
    quoteLogId: args.quoteLogId,
    tenantId: args.tenantId,
    path: ["render_email"],
    value: args.email,
  });
}