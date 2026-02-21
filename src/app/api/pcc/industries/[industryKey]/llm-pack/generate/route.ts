// src/app/api/pcc/industries/[industryKey]/llm-pack/generate/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import crypto from "crypto";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";

import { generateIndustryPack } from "@/lib/pcc/industries/packGenerator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function safeLower(v: unknown) {
  return safeTrim(v).toLowerCase();
}

function isPlainObject(v: any) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

async function loadIndustryMeta(industryKey: string) {
  const r = await db.execute(sql`
    select
      key::text as "key",
      label::text as "label",
      description::text as "description"
    from industries
    where key = ${industryKey}
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  if (!row) return null;

  return {
    key: String(row.key ?? industryKey),
    label: row.label ? String(row.label) : null,
    description: row.description ? String(row.description) : null,
  };
}

async function loadExampleTenants(industryKey: string) {
  const r = await db.execute(sql`
    select
      t.name::text as "name",
      ob.website::text as "website",
      (ob.ai_analysis->>'businessGuess')::text as "summary"
    from tenant_settings ts
    join tenants t on t.id = ts.tenant_id
    left join tenant_onboarding ob on ob.tenant_id = t.id
    where ts.industry_key = ${industryKey}
    order by t.created_at desc
    limit 5
  `);

  const rows: any[] = (r as any)?.rows ?? (Array.isArray(r) ? (r as any) : []);
  return rows.map((x) => ({
    name: x?.name ? String(x.name) : undefined,
    website: x?.website ? String(x.website) : undefined,
    summary: x?.summary ? String(x.summary) : undefined,
  }));
}

/**
 * Normalize the generated pack to the shape our runtime expects:
 * - estimator/qa read: prompts.industryPromptPacks[industryKey].quoteEstimatorSystem / qaQuestionGeneratorSystem
 * - cron render reads: prompts.industryPromptPacks[industryKey].renderPromptAddendum / renderNegativeGuidance
 */
function normalizeGeneratedPack(args: {
  industryKey: string;
  generated: any; // partial platform llm config-ish
  renderPromptAddendum?: string;
  renderNegativeGuidance?: string;
}) {
  const { industryKey } = args;

  const base: any = isPlainObject(args.generated) ? { ...args.generated } : {};
  base.prompts = isPlainObject(base.prompts) ? { ...base.prompts } : {};
  base.prompts.industryPromptPacks = isPlainObject(base.prompts.industryPromptPacks)
    ? { ...base.prompts.industryPromptPacks }
    : {};

  const existingPack = base.prompts.industryPromptPacks[industryKey];
  const nextPack = isPlainObject(existingPack) ? { ...existingPack } : {};

  if (safeTrim(args.renderPromptAddendum)) nextPack.renderPromptAddendum = safeTrim(args.renderPromptAddendum);
  if (safeTrim(args.renderNegativeGuidance)) nextPack.renderNegativeGuidance = safeTrim(args.renderNegativeGuidance);

  base.prompts.industryPromptPacks[industryKey] = nextPack;

  // If generator ever placed these at root, remove them (keep DB clean)
  if ("renderPromptAddendum" in base) delete base.renderPromptAddendum;
  if ("renderNegativeGuidance" in base) delete base.renderNegativeGuidance;

  return base;
}

/**
 * Insert a new version row (append-only) for this industry_key.
 * Compatible with DB shape:
 * industry_key, enabled, version, pack, models, prompts, updated_at
 */
async function insertIndustryPackVersion(args: { industryKey: string; pack: any }) {
  const key = args.industryKey;

  const vr = await db.execute(sql`
    select coalesce(max(version), 0)::int as "v"
    from industry_llm_packs
    where industry_key = ${key}
  `);

  const vrow: any = (vr as any)?.rows?.[0] ?? (Array.isArray(vr) ? (vr as any)[0] : null);
  const nextVersion = Number(vrow?.v ?? 0) + 1;

  const id = crypto.randomUUID();

  const models = isPlainObject(args.pack?.models) ? args.pack.models : {};
  const prompts = isPlainObject(args.pack?.prompts) ? args.pack.prompts : {};

  await db.execute(sql`
    insert into industry_llm_packs (id, industry_key, enabled, version, pack, models, prompts, updated_at)
    values (
      ${id}::uuid,
      ${key},
      true,
      ${nextVersion}::int,
      ${args.pack}::jsonb,
      ${models}::jsonb,
      ${prompts}::jsonb,
      now()
    )
  `);

  return { id, version: nextVersion };
}

const Req = {
  parse(body: any) {
    const modeRaw = safeLower(body?.mode);
    const mode = modeRaw === "refine" || modeRaw === "backfill" || modeRaw === "create" ? modeRaw : "create";

    const model = safeTrim(body?.model) || null;

    const industryLabel = safeTrim(body?.industryLabel) || null;
    const industryDescription = safeTrim(body?.industryDescription) || null;

    const exampleTenants = Array.isArray(body?.exampleTenants) ? body.exampleTenants : null;

    return { mode, model, industryLabel, industryDescription, exampleTenants };
  },
};

// ✅ IMPORTANT: match Next’s typed route signature in this repo
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ industryKey: string }> }
) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

  const p = await context.params;
  const industryKey = safeLower(decodeURIComponent(p?.industryKey ?? ""));
  if (!industryKey) return json({ ok: false, error: "BAD_REQUEST", message: "Missing industryKey" }, 400);

  const body = await req.json().catch(() => ({}));
  const parsed = Req.parse(body);

  // If caller didn’t provide label/description, try canonical industry metadata
  const meta = await loadIndustryMeta(industryKey);

  const label = parsed.industryLabel ?? meta?.label ?? null;
  const description = parsed.industryDescription ?? meta?.description ?? null;

  // If caller didn’t provide examples, derive from real tenants
  const examples =
    parsed.exampleTenants && Array.isArray(parsed.exampleTenants)
      ? parsed.exampleTenants
      : await loadExampleTenants(industryKey);

  const result = await generateIndustryPack({
    industryKey,
    industryLabel: label,
    industryDescription: description,
    exampleTenants: examples,
    mode: parsed.mode as any,
    model: parsed.model ?? undefined,
  });

  const generatedAny: any = result.pack as any;

  const renderPromptAddendum =
    safeTrim(generatedAny?.prompts?.industryPromptPacks?.[industryKey]?.renderPromptAddendum) ||
    safeTrim(generatedAny?.renderPromptAddendum) ||
    "";

  const renderNegativeGuidance =
    safeTrim(generatedAny?.prompts?.industryPromptPacks?.[industryKey]?.renderNegativeGuidance) ||
    safeTrim(generatedAny?.renderNegativeGuidance) ||
    "";

  const normalizedPack = normalizeGeneratedPack({
    industryKey,
    generated: generatedAny,
    renderPromptAddendum,
    renderNegativeGuidance,
  });

  const saved = await insertIndustryPackVersion({ industryKey, pack: normalizedPack });

  return json({
    ok: true,
    industryKey,
    version: saved.version,
    id: saved.id,
    meta: result.meta,
    preview: {
      hasModels: Boolean(normalizedPack?.models && Object.keys(normalizedPack.models).length),
      hasPrompts: Boolean(normalizedPack?.prompts && Object.keys(normalizedPack.prompts).length),
      industryPackKeys: Object.keys(normalizedPack?.prompts?.industryPromptPacks ?? {}),
      renderPromptAddendumLen: renderPromptAddendum.length,
      renderNegativeGuidanceLen: renderNegativeGuidance.length,
    },
  });
}