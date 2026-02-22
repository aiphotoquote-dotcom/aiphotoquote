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

function actorFromReq(req: Request) {
  return (
    safeTrim(req.headers.get("x-clerk-user-id")) ||
    safeTrim(req.headers.get("x-user-id")) ||
    safeTrim(req.headers.get("x-forwarded-for")) ||
    "unknown"
  );
}

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

function jsonbParam(v: any) {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

async function auditMerge(tx: any, args: { sourceKey: string; targetKey: string; actor: string; reason: string | null; payload: any }) {
  const payloadJson = jsonbParam(args.payload);
  await tx.execute(sql`
    insert into industry_change_log (action, source_key, target_key, actor, reason, payload)
    values ('merge', ${args.sourceKey}, ${args.targetKey}, ${args.actor}, ${args.reason}, ${payloadJson}::jsonb)
  `);
}

export async function POST(req: Request) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, 400);
  }

  const sourceKeyIn = safeLower(parsed.data.sourceKey);
  const targetKeyIn = safeLower(parsed.data.targetKey);
  const reason = safeTrim(parsed.data.reason ?? "") || null;
  const deleteSource = parsed.data.deleteSource ?? true;

  if (!sourceKeyIn || !targetKeyIn) return json({ ok: false, error: "BAD_REQUEST", message: "Missing keys" }, 400);
  if (sourceKeyIn === targetKeyIn) return json({ ok: false, error: "BAD_REQUEST", message: "sourceKey == targetKey" }, 400);

  const actor = actorFromReq(req);

  const result = await db.transaction(async (tx) => {
    // Canonical lookups are best-effort:
    // - if a key exists in industries, we use its stored key+label
    // - otherwise, we allow derived keys (no industries row)
    const srcR = await tx.execute(sql`
      select key::text as "key", label::text as "label"
      from industries
      where lower(key) = ${sourceKeyIn}
      limit 1
    `);
    const tgtR = await tx.execute(sql`
      select key::text as "key", label::text as "label"
      from industries
      where lower(key) = ${targetKeyIn}
      limit 1
    `);

    const srcRow: any = (srcR as any)?.rows?.[0] ?? null;
    const tgtRow: any = (tgtR as any)?.rows?.[0] ?? null;

    const sourceKey = srcRow?.key ? safeLower(srcRow.key) : sourceKeyIn;
    const targetKey = tgtRow?.key ? safeLower(tgtRow.key) : targetKeyIn;

    if (sourceKey === targetKey) return { ok: false as const, status: 400, error: "BAD_REQUEST" };

    // If target doesn't exist canonically, we still allow merge INTO it,
    // but ONLY if it already has some footprint (or you’d be “merging into nothing”).
    if (!tgtRow) {
      const footprintR = await tx.execute(sql`
        select
          (select count(*)::int from tenant_settings where industry_key = ${targetKey}) as "tenants",
          (select count(*)::int from industry_llm_packs where industry_key = ${targetKey}) as "packs",
          (select count(*)::int from industry_sub_industries where industry_key = ${targetKey}) as "subs"
      `);
      const fp: any = (footprintR as any)?.rows?.[0] ?? {};
      const n = Number(fp.tenants ?? 0) + Number(fp.packs ?? 0) + Number(fp.subs ?? 0);
      if (n <= 0) {
        return { ok: false as const, status: 404, error: "TARGET_NOT_FOUND" };
      }
    }

    // Counts before (useful to show user + audit)
    const countsBeforeR = await tx.execute(sql`
      select
        (select count(*)::int from tenant_settings where industry_key = ${sourceKey}) as "tenantSettings",
        (select count(*)::int from tenant_sub_industries where industry_key = ${sourceKey}) as "tenantSubIndustries",
        (select count(*)::int from industry_sub_industries where industry_key = ${sourceKey}) as "industrySubIndustries",
        (select count(*)::int from industry_llm_packs where industry_key = ${sourceKey}) as "industryLlmPacks"
    `);
    const countsBefore: any = (countsBeforeR as any)?.rows?.[0] ?? {};

    // 1) Move tenants
    const movedTenantsR = await tx.execute(sql`
      update tenant_settings
      set industry_key = ${targetKey}, updated_at = now()
      where industry_key = ${sourceKey}
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
      where s.industry_key = ${sourceKey}
        and not exists (
          select 1
          from tenant_sub_industries t
          where t.industry_key = ${targetKey}
            and t.tenant_id = s.tenant_id
            and t.key = s.key
        )
    `);
    const insertedTenantSub = Number((insertTenantSubR as any)?.rowCount ?? 0);

    const deletedTenantSubR = await tx.execute(sql`
      delete from tenant_sub_industries
      where industry_key = ${sourceKey}
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
      where s.industry_key = ${sourceKey}
        and not exists (
          select 1
          from industry_sub_industries t
          where t.industry_key = ${targetKey}
            and t.key = s.key
        )
    `);
    const insertedIndustrySub = Number((insertIndustrySubR as any)?.rowCount ?? 0);

    const deletedIndustrySubR = await tx.execute(sql`
      delete from industry_sub_industries
      where industry_key = ${sourceKey}
    `);
    const deletedIndustrySub = Number((deletedIndustrySubR as any)?.rowCount ?? 0);

    // 4) Copy packs into target as NEW versions, then delete source packs
    const maxVR = await tx.execute(sql`
      select coalesce(max(version), 0)::int as "v"
      from industry_llm_packs
      where industry_key = ${targetKey}
    `);
    const maxVRow: any = (maxVR as any)?.rows?.[0] ?? null;
    let nextV = Number(maxVRow?.v ?? 0);

    const srcPacksR = await tx.execute(sql`
      select
        enabled as "enabled",
        version::int as "version",
        pack as "pack",
        models as "models",
        prompts as "prompts",
        updated_at as "updatedAt"
      from industry_llm_packs
      where industry_key = ${sourceKey}
      order by version asc, updated_at asc
    `);
    const srcPacks: any[] = (srcPacksR as any)?.rows ?? [];

    let copiedPacks = 0;
    for (const p of srcPacks) {
      nextV += 1;

      const packJson = jsonbParam(p.pack);
      const modelsJson = jsonbParam(p.models);
      const promptsJson = jsonbParam(p.prompts);

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
      where industry_key = ${sourceKey}
    `);
    const deletedPacks = Number((deletedPacksR as any)?.rowCount ?? 0);

    // 5) Hard delete source industry row if it exists and requested
    let deletedIndustry = 0;
    if (deleteSource) {
      const delR = await tx.execute(sql`
        delete from industries
        where lower(key) = ${sourceKey}
      `);
      deletedIndustry = Number((delR as any)?.rowCount ?? 0);
    }

    const payload = {
      source: { key: sourceKey, label: String(srcRow?.label ?? "") },
      target: { key: targetKey, label: String(tgtRow?.label ?? "") },
      countsBefore,
      moved: {
        tenantSettings: movedTenants,
        tenantSubIndustriesInserted: insertedTenantSub,
        tenantSubIndustriesDeleted: deletedTenantSub,
        industrySubIndustriesInserted: insertedIndustrySub,
        industrySubIndustriesDeleted: deletedIndustrySub,
        industryLlmPacksCopied: copiedPacks,
        industryLlmPacksDeleted: deletedPacks,
      },
      deleted: {
        industriesRow: deletedIndustry,
      },
    };

    await auditMerge(tx, { sourceKey, targetKey, actor, reason, payload });

    return { ok: true as const, sourceKey, targetKey, moved: payload.moved, deleted: payload.deleted };
  });

  if ((result as any)?.ok === false) {
    return json({ ok: false, error: (result as any).error }, (result as any).status ?? 400);
  }

  return json(result, 200);
}