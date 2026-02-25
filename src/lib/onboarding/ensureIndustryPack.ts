// src/lib/onboarding/ensureIndustryPack.ts

import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { generateIndustryPack, type IndustryPackGenerationMode } from "@/lib/pcc/industries/packGenerator";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

/**
 * Keep consistent with platform-wide normalization:
 * - lowercase
 * - collapse non-alnum to "_"
 * - trim underscores
 * - max 64
 */
function normalizeIndustryKey(raw: string) {
  const s = safeTrim(raw).toLowerCase();
  if (!s) return "";
  return s
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function jsonbString(v: any) {
  if (v === undefined || v === null) return "{}";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return "{}";
  }
}

async function readLatestPackRow(industryKey: string) {
  const r = await db.execute(sql`
    select id::text as "id", version::int as "version", enabled as "enabled"
    from industry_llm_packs
    where lower(industry_key) = ${industryKey}
    order by version desc, updated_at desc
    limit 1
  `);
  return (r as any)?.rows?.[0] ?? null;
}

/**
 * Canonical resolver:
 * industry_canonical_map:
 * - source_industry_key (not null)
 * - target_industry_key (nullable; null can mean "deleted/absorbed", treat as no-op for now)
 *
 * We follow mapping chains (A->B->C) up to a safe limit.
 *
 * IMPORTANT: onboarding must NEVER hard-fail if this table isn't deployed yet.
 * If the table is missing (or any lookup fails), we fail-open and keep the input key.
 */
async function resolveCanonicalIndustryKey(inputKey: string) {
  let cur = normalizeIndustryKey(inputKey);
  if (!cur) return "";

  const seen = new Set<string>();
  for (let i = 0; i < 6; i++) {
    if (seen.has(cur)) break;
    seen.add(cur);

    let targetRaw = "";
    try {
      const r = await db.execute(sql`
        select target_industry_key::text as "target"
        from industry_canonical_map
        where source_industry_key = ${cur}
        limit 1
      `);

      targetRaw = safeTrim((r as any)?.rows?.[0]?.target ?? "");
    } catch (e: any) {
      // Postgres undefined_table is 42P01; treat as "no mapping"
      const code = safeTrim(e?.code);
      if (code === "42P01") return cur;
      return cur;
    }

    const target = normalizeIndustryKey(targetRaw);

    // If no mapping, or target is null/empty, stop.
    if (!target) break;

    cur = target;
  }

  return cur;
}

/**
 * Ensure that an industry has at least one industry_llm_packs row.
 * Used by onboarding so a tenant is "truly set up" once industry is known.
 */
export async function ensureIndustryPack(args: {
  industryKey: string;
  industryLabel?: string | null;
  industryDescription?: string | null;

  // Optional onboarding context (helps pack quality)
  tenantId?: string | null;
  website?: string | null;
  summary?: string | null;

  // Advanced / optional
  mode?: IndustryPackGenerationMode; // default: "create"
  model?: string | null; // optional override to packGenerator
}) {
  const inputKeyNorm = normalizeIndustryKey(args.industryKey);
  if (!inputKeyNorm) {
    return { ok: false as const, error: "INDUSTRY_KEY_REQUIRED" };
  }

  // ✅ Canonicalize BEFORE looking for/creating packs (fail-open if mapping table isn't present)
  const canonicalKey = await resolveCanonicalIndustryKey(inputKeyNorm);
  const industryKey = canonicalKey || inputKeyNorm;

  const industryLabel = safeTrim(args.industryLabel) || null;
  const industryDescription = safeTrim(args.industryDescription) || null;

  // 1) If a pack already exists, we’re done.
  const existing = await readLatestPackRow(industryKey);
  if (existing?.id) {
    return {
      ok: true as const,
      industryKey,
      canonicalApplied: industryKey !== inputKeyNorm,
      inputIndustryKey: inputKeyNorm,
      existed: true as const,
      id: String(existing.id),
      version: Number(existing.version ?? 0),
      enabled: Boolean(existing.enabled),
    };
  }

  // 2) Compute next version (usually 1 since none exist)
  const maxVR = await db.execute(sql`
    select coalesce(max(version), 0)::int as "v"
    from industry_llm_packs
    where lower(industry_key) = ${industryKey}
  `);
  const maxVRow: any = (maxVR as any)?.rows?.[0] ?? null;
  const nextV = Number(maxVRow?.v ?? 0) + 1;

  // 3) Generate pack
  const mode: IndustryPackGenerationMode = (args.mode ?? "create") as IndustryPackGenerationMode;

  const exampleTenants =
    safeTrim(args.website) || safeTrim(args.summary)
      ? [
          {
            name: undefined,
            website: safeTrim(args.website) || undefined,
            summary: safeTrim(args.summary) || undefined,
          },
        ]
      : [];

  const gen = await generateIndustryPack({
    industryKey,
    industryLabel,
    industryDescription,
    exampleTenants,
    mode,
    model: safeTrim(args.model) || undefined,
  });

  // 4) Persist
  const packJson = jsonbString(gen.pack);
  const promptsJson = jsonbString((gen.pack as any)?.prompts ?? {});
  const modelsJson = jsonbString((gen.pack as any)?.models ?? {});

  const insR = await db.execute(sql`
    insert into industry_llm_packs (id, industry_key, enabled, version, pack, models, prompts, updated_at)
    values (
      gen_random_uuid(),
      ${industryKey},
      true,
      ${nextV}::int,
      ${packJson}::jsonb,
      ${modelsJson}::jsonb,
      ${promptsJson}::jsonb,
      now()
    )
    returning id::text as "id", version::int as "version"
  `);

  const inserted = (insR as any)?.rows?.[0] ?? null;

  // 5) Re-read winner (defensive, and keeps behavior stable if insert triggers/etc)
  const winner = await readLatestPackRow(industryKey);

  return {
    ok: true as const,
    industryKey,
    canonicalApplied: industryKey !== inputKeyNorm,
    inputIndustryKey: inputKeyNorm,
    existed: false as const,
    id: safeTrim(winner?.id || inserted?.id) || null,
    version: Number(winner?.version ?? inserted?.version ?? nextV),
    meta: gen.meta,
  };
}