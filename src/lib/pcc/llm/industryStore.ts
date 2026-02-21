// src/lib/pcc/llm/industryStore.ts
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import type { PlatformLlmConfig } from "@/lib/pcc/llm/types";

/**
 * DB-backed industry prompt packs.
 *
 * IMPORTANT: This file supports BOTH schemas:
 *
 * ✅ New / preferred schema (single canonical pack + metadata):
 *   - industry_key text UNIQUE NOT NULL
 *   - pack jsonb NOT NULL
 *   - version int NOT NULL
 *   - created_at timestamptz
 *   - updated_by text
 *   - source jsonb
 *   - updated_at timestamptz
 *
 * 🧱 Legacy schema (older deployments):
 *   - industry_key text NOT NULL
 *   - enabled boolean NOT NULL
 *   - version int NOT NULL
 *   - pack jsonb NOT NULL default {}
 *   - models jsonb NOT NULL default {}
 *   - prompts jsonb NOT NULL default {}
 *   - updated_at timestamptz
 *
 * We attempt NEW first, then fallback to LEGACY if columns do not exist.
 */

function isPlainObject(v: any) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function isUndefinedColumnError(e: any) {
  // Postgres: undefined_column => SQLSTATE 42703
  const code = String(e?.code ?? "");
  if (code === "42703") return true;
  const msg = String(e?.message ?? "");
  return msg.toLowerCase().includes("column") && msg.toLowerCase().includes("does not exist");
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

  // Fallback: legacy separate columns
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

type PackMeta = {
  industryKey: string;
  version: number;
  updatedAt: string | null;
  createdAt?: string | null;
  updatedBy?: string | null;
  source?: any | null;
};

function rowToMeta(row: any, industryKey: string): PackMeta {
  return {
    industryKey,
    version: Number(row?.version ?? 1) || 1,
    updatedAt: row?.updated_at ? String(row.updated_at) : null,
    createdAt: row?.created_at ? String(row.created_at) : null,
    updatedBy: row?.updated_by ? String(row.updated_by) : null,
    source: row?.source ?? null,
  };
}

/**
 * Returns the latest pack for an industry_key, or null.
 *
 * NOTE: we return only the pack content (Partial<PlatformLlmConfig>) to preserve
 * your existing resolver expectations.
 */
export async function getIndustryLlmPack(industryKey: string | null | undefined): Promise<Partial<PlatformLlmConfig> | null> {
  const key = safeTrim(industryKey).toLowerCase();
  if (!key) return null;

  // ✅ NEW schema attempt (no enabled/models/prompts columns required)
  try {
    const r = await db.execute(sql`
      select industry_key, version, pack, created_at, updated_by, source, updated_at
      from industry_llm_packs
      where industry_key = ${key}
      order by version desc, updated_at desc
      limit 1
    `);

    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
    return normalizePackRow(row);
  } catch (e: any) {
    if (!isUndefinedColumnError(e)) throw e;
    // fallthrough to legacy
  }

  // 🧱 LEGACY schema fallback
  const r2 = await db.execute(sql`
    select industry_key, enabled, version, pack, models, prompts, updated_at
    from industry_llm_packs
    where industry_key = ${key}
      and enabled = true
    order by version desc, updated_at desc
    limit 1
  `);

  const row2: any = (r2 as any)?.rows?.[0] ?? (Array.isArray(r2) ? (r2 as any)[0] : null);
  return normalizePackRow(row2);
}

/**
 * Same as getIndustryLlmPack, but also returns metadata for audit/debug UI.
 * Safe to add without changing existing call sites.
 */
export async function getIndustryLlmPackWithMeta(
  industryKey: string | null | undefined
): Promise<{ pack: Partial<PlatformLlmConfig> | null; meta: PackMeta | null }> {
  const key = safeTrim(industryKey).toLowerCase();
  if (!key) return { pack: null, meta: null };

  // ✅ NEW schema attempt
  try {
    const r = await db.execute(sql`
      select industry_key, version, pack, created_at, updated_by, source, updated_at
      from industry_llm_packs
      where industry_key = ${key}
      order by version desc, updated_at desc
      limit 1
    `);

    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
    return { pack: normalizePackRow(row), meta: row ? rowToMeta(row, key) : null };
  } catch (e: any) {
    if (!isUndefinedColumnError(e)) throw e;
  }

  // 🧱 LEGACY schema fallback
  const r2 = await db.execute(sql`
    select industry_key, enabled, version, pack, models, prompts, updated_at
    from industry_llm_packs
    where industry_key = ${key}
      and enabled = true
    order by version desc, updated_at desc
    limit 1
  `);

  const row2: any = (r2 as any)?.rows?.[0] ?? (Array.isArray(r2) ? (r2 as any)[0] : null);
  return {
    pack: normalizePackRow(row2),
    meta: row2
      ? {
          industryKey: key,
          version: Number(row2?.version ?? 1) || 1,
          updatedAt: row2?.updated_at ? String(row2.updated_at) : null,
          createdAt: null,
          updatedBy: null,
          source: null,
        }
      : null,
  };
}

/**
 * Upsert an industry prompt pack.
 *
 * This is the modular entry point for:
 * - onboarding generation (create if missing)
 * - PCC backfill (regenerate + overwrite)
 * - manual "save" from PCC UI
 *
 * We store pack as:
 *   { models?: {...}, prompts?: {...} }
 *
 * Guardrails remain platform-locked (do NOT store guardrails here).
 */
export async function upsertIndustryLlmPack(args: {
  industryKey: string;
  pack: Partial<PlatformLlmConfig>;
  version?: number;
  updatedBy?: string | null;
  source?: any | null;
}): Promise<void> {
  const key = safeTrim(args.industryKey).toLowerCase();
  if (!key) {
    const e: any = new Error("INDUSTRY_KEY_REQUIRED");
    e.code = "INDUSTRY_KEY_REQUIRED";
    throw e;
  }

  // Only persist the pieces we expect here
  const safePack = {
    ...(isPlainObject((args.pack as any)?.models) ? { models: (args.pack as any).models } : {}),
    ...(isPlainObject((args.pack as any)?.prompts) ? { prompts: (args.pack as any).prompts } : {}),
  };

  const hasAnything = Object.keys(safePack).length > 0;
  if (!hasAnything) {
    const e: any = new Error("INDUSTRY_PACK_EMPTY");
    e.code = "INDUSTRY_PACK_EMPTY";
    throw e;
  }

  const version = Number.isFinite(args.version as any) ? Number(args.version) : 1;
  const updatedBy = safeTrim(args.updatedBy ?? "") || null;
  const source = args.source ?? null;

  // ✅ NEW schema attempt
  try {
    await db.execute(sql`
      insert into industry_llm_packs (industry_key, pack, version, updated_by, source, updated_at)
      values (${key}, ${safePack as any}::jsonb, ${version}, ${updatedBy}, ${source as any}::jsonb, now())
      on conflict (industry_key)
      do update set
        pack = excluded.pack,
        version = excluded.version,
        updated_by = excluded.updated_by,
        source = excluded.source,
        updated_at = now()
    `);
    return;
  } catch (e: any) {
    if (!isUndefinedColumnError(e)) throw e;
    // fallthrough to legacy
  }

  // 🧱 LEGACY schema fallback
  // We keep enabled=true for writes (pack is "active").
  const models = isPlainObject((safePack as any).models) ? (safePack as any).models : {};
  const prompts = isPlainObject((safePack as any).prompts) ? (safePack as any).prompts : {};

  await db.execute(sql`
    insert into industry_llm_packs (industry_key, enabled, version, pack, models, prompts, updated_at)
    values (${key}, true, ${version}, ${safePack as any}::jsonb, ${models as any}::jsonb, ${prompts as any}::jsonb, now())
    on conflict (industry_key)
    do update set
      enabled = true,
      version = excluded.version,
      pack = excluded.pack,
      models = excluded.models,
      prompts = excluded.prompts,
      updated_at = now()
  `);
}

/**
 * Helper for backfill tooling:
 * Returns industry keys that exist in `tenant_settings` or `industries` but have no pack row yet.
 *
 * We attempt to use industries table first when populated, but always fall back safely.
 */
export async function listIndustryKeysMissingPack(limit = 500): Promise<string[]> {
  const lim = Math.max(1, Math.min(2000, Number(limit) || 500));

  // Strategy:
  // - gather candidate keys from (industries UNION tenant_settings)
  // - left join industry_llm_packs
  // - return where pack row missing
  //
  // Works on both schemas because industry_llm_packs always has industry_key.
  const r = await db.execute(sql`
    with keys as (
      select distinct key::text as industry_key
      from industries
      where key is not null and key <> ''

      union

      select distinct industry_key::text as industry_key
      from tenant_settings
      where industry_key is not null and industry_key <> ''
    )
    select k.industry_key
    from keys k
    left join industry_llm_packs p on p.industry_key = k.industry_key
    where p.industry_key is null
    order by k.industry_key asc
    limit ${lim}
  `);

  const rows: any[] = (r as any)?.rows ?? (Array.isArray(r) ? (r as any) : []);
  return rows.map((x) => safeTrim(x?.industry_key)).filter(Boolean);
}