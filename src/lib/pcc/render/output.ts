// src/lib/pcc/render/output.ts
import { sql, and, eq } from "drizzle-orm";
import type { AnyPgDatabase } from "drizzle-orm/pg-core";
import { quoteLogs } from "@/lib/db/schema";

/**
 * Safely sets a nested key under quote_logs.output using jsonb_set,
 * preventing overwrites of other output fields.
 *
 * Example path: ["render_debug"] or ["render_email"]
 */
export async function setQuoteOutputPath(args: {
  db: AnyPgDatabase;
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
  db: AnyPgDatabase;
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
  db: AnyPgDatabase;
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