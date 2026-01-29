// src/lib/pcc/llm/tenantStore.ts

import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { normalizeTenantOverrides, type TenantLlmOverrides } from "./tenantTypes";

// ✅ Re-export for backwards compatibility (so imports from tenantStore keep working)
export type { TenantLlmOverrides } from "./tenantTypes";

function nowIso() {
  return new Date().toISOString();
}

export async function loadTenantLlmOverrides(tenantId: string): Promise<TenantLlmOverrides | null> {
  const tid = String(tenantId || "").trim();
  if (!tid) return null;

  const rows = await db.execute(sql`
    SELECT tenant_id, models, prompts, updated_at
    FROM tenant_llm_overrides
    WHERE tenant_id = ${tid}::uuid
    LIMIT 1
  `);

  const r: any = (rows as any)?.rows?.[0] ?? null;
  if (!r) return null;

  const out = normalizeTenantOverrides({
    models: r.models ?? {},
    prompts: r.prompts ?? {},
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : undefined,
  });

  return out;
}

export async function saveTenantLlmOverrides(
  tenantId: string,
  overrides: TenantLlmOverrides
): Promise<TenantLlmOverrides> {
  const tid = String(tenantId || "").trim();
  if (!tid) throw new Error("Missing tenantId");

  const normalized = normalizeTenantOverrides(overrides);
  const models = normalized.models ?? {};
  const prompts = normalized.prompts ?? {};
  const updatedAt = nowIso();

  await db.execute(sql`
    INSERT INTO tenant_llm_overrides (tenant_id, models, prompts, updated_at)
    VALUES (
      ${tid}::uuid,
      ${JSON.stringify(models)}::jsonb,
      ${JSON.stringify(prompts)}::jsonb,
      ${updatedAt}::timestamptz
    )
    ON CONFLICT (tenant_id)
    DO UPDATE SET
      models = EXCLUDED.models,
      prompts = EXCLUDED.prompts,
      updated_at = EXCLUDED.updated_at
  `);

  return { ...normalized, updatedAt };
}