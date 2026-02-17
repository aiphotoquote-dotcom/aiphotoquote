// src/lib/pcc/llm/industryStore.ts
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import type { PlatformLlmConfig } from "@/lib/pcc/llm/types";

/**
 * DB-backed industry prompt packs.
 *
 * Table shape (per your Neon output):
 * - industry_key text NOT NULL
 * - enabled boolean NOT NULL
 * - version int NOT NULL
 * - pack jsonb NOT NULL default {}
 * - models jsonb NOT NULL default {}
 * - prompts jsonb NOT NULL default {}
 *
 * We treat `pack` as canonical when present, but support legacy/partial rows by
 * falling back to `models` + `prompts`.
 */
function isPlainObject(v: any) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function normalizePackRow(row: any): Partial<PlatformLlmConfig> | null {
  if (!row) return null;

  // Prefer `pack` if it looks like { models, prompts }
  const pack = row.pack;
  if (isPlainObject(pack)) {
    const models = isPlainObject(pack.models) ? pack.models : undefined;
    const prompts = isPlainObject(pack.prompts) ? pack.prompts : undefined;

    if (models || prompts) {
      return {
        ...(models ? { models } : {}),
        ...(prompts ? { prompts } : {}),
      } as any;
    }
  }

  // Fallback: separate columns
  const models = row.models;
  const prompts = row.prompts;

  const hasModels = isPlainObject(models) && Object.keys(models).length > 0;
  const hasPrompts = isPlainObject(prompts) && Object.keys(prompts).length > 0;

  if (!hasModels && !hasPrompts) return null;

  return {
    ...(hasModels ? { models } : {}),
    ...(hasPrompts ? { prompts } : {}),
  } as any;
}

/**
 * Returns the latest enabled pack for an industry_key, or null.
 */
export async function getIndustryLlmPack(industryKey: string | null | undefined): Promise<Partial<PlatformLlmConfig> | null> {
  const key = safeTrim(industryKey).toLowerCase();
  if (!key) return null;

  const r = await db.execute(sql`
    select industry_key, enabled, version, pack, models, prompts, updated_at
    from industry_llm_packs
    where industry_key = ${key}
      and enabled = true
    order by version desc, updated_at desc
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  return normalizePackRow(row);
}