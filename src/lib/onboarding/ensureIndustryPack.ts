// src/lib/onboarding/ensureIndustryPack.ts

import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { generateIndustryPack, type IndustryPackGenerationMode } from "@/lib/pcc/industries/packGenerator";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

/**
 * Keep consistent with your platform-wide normalization style:
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

/**
 * Ensure that an industry has at least one industry_llm_packs row.
 * This is used by onboarding so a tenant is "truly set up" once industry is known.
 */
export async function ensureIndustryPack(args: {
  industryKey: string;
  industryLabel?: string | null;
  industryDescription?: string | null;

  // Optional context from onboarding (helps pack quality, but not required)
  tenantId?: string | null;
  website?: string | null;
  summary?: string | null;

  // Advanced / optional
  mode?: IndustryPackGenerationMode; // default: "create"
  model?: string | null; // optional override to packGenerator
}) {
  const industryKey = normalizeIndustryKey(args.industryKey);
  if (!industryKey) {
    return { ok: false as const, error: "INDUSTRY_KEY_REQUIRED" };
  }

  const industryLabel = safeTrim(args.industryLabel) || null;
  const industryDescription = safeTrim(args.industryDescription) || null;

  // 1) If a pack already exists for this industry, we’re done.
  const existsR = await db.execute(sql`
    select id::text as "id", version::int as "version", enabled as "enabled"
    from industry_llm_packs
    where lower(industry_key) = ${industryKey}
    order by version desc, updated_at desc
    limit 1
  `);

  const existing = (existsR as any)?.rows?.[0] ?? null;
  if (existing?.id) {
    return {
      ok: true as const,
      industryKey,
      existed: true as const,
      id: String(existing.id),
      version: Number(existing.version ?? 0),
      enabled: Boolean(existing.enabled),
    };
  }

  // 2) Compute next version (usually 1 since none exist, but safe anyway)
  const maxVR = await db.execute(sql`
    select coalesce(max(version), 0)::int as "v"
    from industry_llm_packs
    where lower(industry_key) = ${industryKey}
  `);
  const maxVRow: any = (maxVR as any)?.rows?.[0] ?? null;
  const nextV = Number(maxVRow?.v ?? 0) + 1;

  // 3) Generate pack (PURE generator, requires mode)
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

  // 4) Persist row
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

  return {
    ok: true as const,
    industryKey,
    existed: false as const,
    id: safeTrim(inserted?.id) || null,
    version: Number(inserted?.version ?? nextV),
    meta: gen.meta,
  };
}