// src/app/api/pcc/industries/merge/route.ts

import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  sourceKey: z.string().min(1),
  targetKey: z.string().min(1),
  reason: z.string().optional().nullable(),
  deleteSource: z.boolean().optional(), // default true
});

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}
function safeLower(v: unknown) {
  return safeTrim(v).toLowerCase();
}

function titleFromKey(key: string) {
  const s = safeTrim(key);
  if (!s) return "";
  return s
    .split(/[_\-]+/g)
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(" ");
}

function actorFromReq(req: Request) {
  return (
    safeTrim(req.headers.get("x-clerk-user-id")) ||
    safeTrim(req.headers.get("x-user-id")) ||
    safeTrim(req.headers.get("x-forwarded-for")) ||
    "platform"
  );
}

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
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

async function auditMerge(tx: any, args: { sourceKey: string; targetKey: string; actor: string; reason: string | null; snapshot: any }) {
  const snapshotJson = jsonbString(args.snapshot);
  // ✅ keep consistent with your delete route + real DB
  await tx.execute(sql`
    insert into industry_change_log (action, source_industry_key, target_industry_key, actor, reason, snapshot)
    values ('merge', ${args.sourceKey}, ${args.targetKey}, ${args.actor}, ${args.reason}, ${snapshotJson}::jsonb)
  `);
}

export async function POST(req: Request) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, 400);
  }

  const sourceKey = safeLower(parsed.data.sourceKey);
  const targetKey = safeLower(parsed.data.targetKey);
  const reason = safeTrim(parsed.data.reason ?? "") || null;
  const deleteSource = parsed.data.deleteSource ?? true;

  if (!sourceKey || !targetKey) return json({ ok: false, error: "BAD_REQUEST", message: "Missing keys" }, 400);
  if (sourceKey === targetKey) return json({ ok: false, error: "BAD_REQUEST", message: "sourceKey == targetKey" }, 400);

  const actor = actorFromReq(req);

  const result = await db.transaction(async (tx) => {
    // Optional labels (for audit + response only)
    const srcCanonR = await tx.execute(sql`
      select key::text as "key", label::text as "label"
      from industries
      where lower(key) = ${sourceKey}
      limit 1
    `);
    const tgtCanonR = await tx.execute(sql`
      select key::text as "key", label::text as "label"
      from industries
      where lower(key) = ${targetKey}
      limit 1
    `);

    const srcCanon: any = (srcCanonR as any)?.rows?.[0] ?? null;
    const tgtCanon: any = (tgtCanonR as any)?.rows?.[0] ?? null;

    const srcLabel = safeTrim(srcCanon?.label) || titleFromKey(sourceKey) || sourceKey;
    const tgtLabel = safeTrim(tgtCanon?.label) || titleFromKey(targetKey) || targetKey;

    // Counts before (for audit/debug)
    const countsBeforeR = await tx.execute(sql`
      select
        (select count(*)::int from tenant_settings where lower(industry_key) = ${sourceKey}) as "tenantSettings",
        (select count(*)::int from tenant_sub_industries where lower(industry_key) = ${sourceKey}) as "tenantSubIndustries",
        (select count(*)::int from industry_sub_industries where lower(industry_key) = ${sourceKey}) as "industrySubIndustries",
        (select count(*)::int from industry_llm_packs where lower(industry_key) = ${sourceKey}) as "industryLlmPacks",
        (select count(*)::int from tenant_onboarding where lower((ai_analysis->>'suggestedIndustryKey')::text) = ${sourceKey}) as "onboardingSuggestedRows",
        (select count(*)::int from tenant_onboarding where coalesce(ai_analysis->'rejectedIndustryKeys','[]'::jsonb) ? ${sourceKey}) as "onboardingRejectedRows"
    `);
    const countsBefore: any = (countsBeforeR as any)?.rows?.[0] ?? {};

    // 1) Move tenants (authoritative pointer)
    const movedTenantsR = await tx.execute(sql`
      update tenant_settings
      set industry_key = ${targetKey}, updated_at = now()
      where lower(industry_key) = ${sourceKey}
      returning tenant_id
    `);
    const movedTenants = ((movedTenantsR as any)?.rows ?? []).length;

    // 2) Merge tenant_sub_industries
    const insertTenantSubR = await tx.execute(sql`
      insert into tenant_sub_industries (tenant_id, industry_key, key, label, created_at, updated_at)
      select
        s.tenant_id,
        ${targetKey},
        s.key,
        s.label,
        s.created_at,
        now()
      from tenant_sub_industries s
      where lower(s.industry_key) = ${sourceKey}
        and not exists (
          select 1
          from tenant_sub_industries t
          where lower(t.industry_key) = ${targetKey}
            and t.tenant_id = s.tenant_id
            and t.key = s.key
        )
    `);
    const insertedTenantSub = Number((insertTenantSubR as any)?.rowCount ?? 0);

    const deletedTenantSubR = await tx.execute(sql`
      delete from tenant_sub_industries
      where lower(industry_key) = ${sourceKey}
    `);
    const deletedTenantSub = Number((deletedTenantSubR as any)?.rowCount ?? 0);

    // 3) Merge industry_sub_industries defaults
    const insertIndustrySubR = await tx.execute(sql`
      insert into industry_sub_industries (id, industry_key, key, label, description, sort_order, is_active, created_at, updated_at)
      select
        gen_random_uuid(),
        ${targetKey},
        s.key,
        s.label,
        s.description,
        s.sort_order,
        s.is_active,
        s.created_at,
        now()
      from industry_sub_industries s
      where lower(s.industry_key) = ${sourceKey}
        and not exists (
          select 1
          from industry_sub_industries t
          where lower(t.industry_key) = ${targetKey}
            and t.key = s.key
        )
    `);
    const insertedIndustrySub = Number((insertIndustrySubR as any)?.rowCount ?? 0);

    const deletedIndustrySubR = await tx.execute(sql`
      delete from industry_sub_industries
      where lower(industry_key) = ${sourceKey}
    `);
    const deletedIndustrySub = Number((deletedIndustrySubR as any)?.rowCount ?? 0);

    // 4) Packs (copy into new versions under target)
    const maxVR = await tx.execute(sql`
      select coalesce(max(version), 0)::int as "v"
      from industry_llm_packs
      where lower(industry_key) = ${targetKey}
    `);
    const maxVRow: any = (maxVR as any)?.rows?.[0] ?? null;
    let nextV = Number(maxVRow?.v ?? 0);

    const srcPacksR = await tx.execute(sql`
      select enabled as "enabled", version::int as "version", pack as "pack", models as "models", prompts as "prompts"
      from industry_llm_packs
      where lower(industry_key) = ${sourceKey}
      order by version asc, updated_at asc
    `);
    const srcPacks: any[] = (srcPacksR as any)?.rows ?? [];

    let copiedPacks = 0;
    for (const p of srcPacks) {
      nextV += 1;

      const packJson = jsonbString(p.pack);
      const modelsJson = jsonbString(p.models);
      const promptsJson = jsonbString(p.prompts);

      await tx.execute(sql`
        insert into industry_llm_packs (id, industry_key, enabled, version, pack, models, prompts, updated_at)
        values (
          gen_random_uuid(),
          ${targetKey},
          ${Boolean(p.enabled)},
          ${nextV}::int,
          ${packJson}::jsonb,
          ${modelsJson}::jsonb,
          ${promptsJson}::jsonb,
          now()
        )
      `);

      copiedPacks += 1;
    }

    const deletedPacksR = await tx.execute(sql`
      delete from industry_llm_packs
      where lower(industry_key) = ${sourceKey}
    `);
    const deletedPacks = Number((deletedPacksR as any)?.rowCount ?? 0);

    // 5) ✅ Move onboarding AI signals (so derived counts collapse into target)
    const movedSuggestedR = await tx.execute(sql`
      update tenant_onboarding
      set ai_analysis = jsonb_set(
        coalesce(ai_analysis,'{}'::jsonb),
        '{suggestedIndustryKey}',
        to_jsonb(${targetKey}::text),
        true
      )
      where lower((ai_analysis->>'suggestedIndustryKey')::text) = ${sourceKey}
    `);
    const movedSuggested = Number((movedSuggestedR as any)?.rowCount ?? 0);

    // Replace sourceKey -> targetKey inside rejectedIndustryKeys arrays, de-dupe
    const movedRejectedR = await tx.execute(sql`
      update tenant_onboarding
      set ai_analysis = jsonb_set(
        coalesce(ai_analysis,'{}'::jsonb),
        '{rejectedIndustryKeys}',
        coalesce(
          (
            select jsonb_agg(distinct v2.val)
            from (
              select
                case
                  when v.value = ${sourceKey} then ${targetKey}
                  else v.value
                end as val
              from jsonb_array_elements_text(coalesce(ai_analysis->'rejectedIndustryKeys','[]'::jsonb)) v(value)
            ) v2
          ),
          '[]'::jsonb
        ),
        true
      )
      where coalesce(ai_analysis->'rejectedIndustryKeys','[]'::jsonb) ? ${sourceKey}
    `);
    const movedRejected = Number((movedRejectedR as any)?.rowCount ?? 0);

    // 6) Optional: delete source industries row (if it exists)
    let deletedIndustry = 0;
    if (deleteSource) {
      const delR = await tx.execute(sql`
        delete from industries
        where lower(key) = ${sourceKey}
      `);
      deletedIndustry = Number((delR as any)?.rowCount ?? 0);
    }

    const snapshot = {
      mode: "merge_industry_key",
      source: { key: sourceKey, label: srcLabel, wasCanonical: Boolean(srcCanon) },
      target: { key: targetKey, label: tgtLabel, wasCanonical: Boolean(tgtCanon) },
      countsBefore,
      moved: {
        tenantSettings: movedTenants,
        tenantSubIndustriesInserted: insertedTenantSub,
        tenantSubIndustriesDeleted: deletedTenantSub,
        industrySubIndustriesInserted: insertedIndustrySub,
        industrySubIndustriesDeleted: deletedIndustrySub,
        industryLlmPacksCopied: copiedPacks,
        industryLlmPacksDeleted: deletedPacks,
        onboardingSuggestedMoved: movedSuggested,
        onboardingRejectedMoved: movedRejected,
      },
      deleted: { industriesRow: deletedIndustry },
    };

    await auditMerge(tx, { sourceKey, targetKey, actor, reason, snapshot });

    return { ok: true as const, sourceKey, targetKey, moved: snapshot.moved, deleted: snapshot.deleted };
  });

  return json(result, 200);
}