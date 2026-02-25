// src/lib/onboarding/platformConfig.ts

import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { generateIndustryPack } from "@/lib/pcc/industries/packGenerator";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

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
 * Ensure a baseline industry pack exists for an industry.
 * This helper is safe to call during onboarding / setup.
 *
 * IMPORTANT:
 * - generateIndustryPack() does NOT accept tenantId.
 * - If you want tenant context, pass it via exampleTenants summary/website.
 */
export async function ensureIndustryPackInDb(args: {
  tenantId?: string | null; // kept for caller convenience/logging, NOT passed to generator
  industryKey: string;
  industryLabel?: string | null;
  industryDescription?: string | null;
  website?: string | null;
  summary?: string | null;
  model?: string | null;
}) {
  const industryKey = normalizeIndustryKey(args.industryKey);
  if (!industryKey) return { ok: false as const, error: "INDUSTRY_KEY_REQUIRED" };

  const industryLabel = safeTrim(args.industryLabel) || null;
  const industryDescription = safeTrim(args.industryDescription) || null;

  // Already exists?
  const existsR = await db.execute(sql`
    select id::text as "id", version::int as "version"
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
    };
  }

  // Next version
  const maxVR = await db.execute(sql`
    select coalesce(max(version), 0)::int as "v"
    from industry_llm_packs
    where lower(industry_key) = ${industryKey}
  `);
  const maxVRow: any = (maxVR as any)?.rows?.[0] ?? null;
  const nextV = Number(maxVRow?.v ?? 0) + 1;

  // Generate pack (✅ no tenantId; ✅ include required mode)
  const exampleTenants =
    safeTrim(args.website) || safeTrim(args.summary)
      ? [
          {
            website: safeTrim(args.website) || undefined,
            summary: safeTrim(args.summary) || undefined,
          },
        ]
      : [];

  const packResult = await generateIndustryPack({
    industryKey,
    industryLabel,
    industryDescription,
    exampleTenants,
    mode: "create",
    model: safeTrim(args.model) || undefined,
  });

  const packJson = jsonbString(packResult.pack);
  const promptsJson = jsonbString((packResult.pack as any)?.prompts ?? {});
  const modelsJson = jsonbString((packResult.pack as any)?.models ?? {});

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
    meta: packResult.meta,
  };
}