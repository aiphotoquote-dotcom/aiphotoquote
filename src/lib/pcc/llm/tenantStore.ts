// src/lib/pcc/llm/tenantStore.ts
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

/**
 * IMPORTANT:
 * tenant_llm_overrides schema is:
 * - tenant_id (uuid) PRIMARY KEY
 * - models (jsonb)
 * - prompts (jsonb)
 * - updated_at (timestamptz)
 *
 * There is NO version column.
 */

export type TenantLlmOverridesRow = {
  tenantId: string;
  models: Record<string, any>;
  prompts: Record<string, any>;
  updatedAt: string | null;
};

function asObj(v: unknown): Record<string, any> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as any;
  return {};
}

export async function getTenantLlmOverrides(tenantId: string): Promise<TenantLlmOverridesRow | null> {
  const rows: any = await db.execute(sql`
    select
      tenant_id,
      coalesce(models, '{}'::jsonb) as models,
      coalesce(prompts, '{}'::jsonb) as prompts,
      updated_at
    from tenant_llm_overrides
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);

  const r = (rows as any)?.[0] ?? (rows as any)?.rows?.[0] ?? null;
  if (!r) return null;

  return {
    tenantId: String(r.tenant_id),
    models: asObj(r.models),
    prompts: asObj(r.prompts),
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  };
}

export async function upsertTenantLlmOverrides(args: {
  tenantId: string;
  models?: unknown;
  prompts?: unknown;
}): Promise<void> {
  const tenantId = args.tenantId;
  const models = asObj(args.models);
  const prompts = asObj(args.prompts);

  await db.execute(sql`
    insert into tenant_llm_overrides (tenant_id, models, prompts, updated_at)
    values (
      ${tenantId}::uuid,
      ${JSON.stringify(models)}::jsonb,
      ${JSON.stringify(prompts)}::jsonb,
      now()
    )
    on conflict (tenant_id) do update
    set
      models = excluded.models,
      prompts = excluded.prompts,
      updated_at = now()
  `);
}