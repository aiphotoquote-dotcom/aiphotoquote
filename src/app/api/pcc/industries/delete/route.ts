// src/app/api/pcc/industries/delete/route.ts

import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  industryKey: z.string().min(1),
  reason: z.string().optional().nullable(),
});

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

// ✅ single canonical normalization rule for PCC keys
function normalizeIndustryKey(v: unknown) {
  const s = safeTrim(v).toLowerCase();
  if (!s) return "";
  // spaces / hyphens -> underscore, collapse runs, trim underscores
  return s
    .replace(/[\s\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
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

async function auditDelete(tx: any, args: { industryKey: string; actor: string; reason: string | null; snapshot: any }) {
  const snapshotJson = jsonbString(args.snapshot);
  // ✅ matches your real table: source_industry_key / target_industry_key / snapshot
  await tx.execute(sql`
    insert into industry_change_log (action, source_industry_key, target_industry_key, actor, reason, snapshot)
    values ('delete', ${args.industryKey}, null, ${args.actor}, ${args.reason}, ${snapshotJson}::jsonb)
  `);
}

export async function POST(req: Request) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, 400);
  }

  const industryKey = normalizeIndustryKey(parsed.data.industryKey);
  const reason = safeTrim(parsed.data.reason ?? "") || null;

  if (!industryKey) return json({ ok: false, error: "BAD_REQUEST", message: "industryKey is required" }, 400);

  const actor = actorFromReq(req);

  const result = await db.transaction(async (tx) => {
    // 1) ✅ Block ONLY if ACTIVE tenants are still assigned to this industry (archived tenants do not block purge)
    const activeTenantCountR = await tx.execute(sql`
      select count(*)::int as "n"
      from tenant_settings ts
      join tenants t on t.id = ts.tenant_id
      where lower(regexp_replace(trim(ts.industry_key), '[\\s\\-]+', '_', 'g')) = ${industryKey}
        and coalesce(t.status,'active') = 'active'
    `);
    const nActiveTenants = Number((activeTenantCountR as any)?.rows?.[0]?.n ?? 0);
    if (nActiveTenants > 0) {
      return {
        ok: false as const,
        status: 409,
        error: "HAS_TENANTS",
        message: `Cannot delete: ${nActiveTenants} ACTIVE tenants still assigned.`,
      };
    }

    // 2) Counts before (for audit/response)
    const countsBeforeR = await tx.execute(sql`
      select
        (select count(*)::int
          from tenant_sub_industries
          where lower(regexp_replace(trim(industry_key), '[\\s\\-]+', '_', 'g')) = ${industryKey}
        ) as "tenantSubIndustries",
        (select count(*)::int
          from industry_sub_industries
          where lower(regexp_replace(trim(industry_key), '[\\s\\-]+', '_', 'g')) = ${industryKey}
        ) as "industrySubIndustries",
        (select count(*)::int
          from industry_llm_packs
          where lower(regexp_replace(trim(industry_key), '[\\s\\-]+', '_', 'g')) = ${industryKey}
        ) as "industryLlmPacks",
        (select count(*)::int
          from industries
          where lower(regexp_replace(trim(key), '[\\s\\-]+', '_', 'g')) = ${industryKey}
        ) as "industriesRow",
        (select count(*)::int
          from tenant_onboarding
          where lower(regexp_replace(trim((ai_analysis->>'suggestedIndustryKey')::text), '[\\s\\-]+', '_', 'g')) = ${industryKey}
        ) as "onboardingSuggestedRows",
        (select count(*)::int
          from tenant_onboarding
          where exists (
            select 1
            from jsonb_array_elements_text(coalesce(ai_analysis->'rejectedIndustryKeys','[]'::jsonb)) v(value)
            where lower(regexp_replace(trim(v.value), '[\\s\\-]+', '_', 'g')) = ${industryKey}
          )
        ) as "onboardingRejectedRows"
    `);
    const countsBefore: any = (countsBeforeR as any)?.rows?.[0] ?? {};

    // 3) Delete platform artifacts for this key (normalized match)
    const delTenantSubR = await tx.execute(sql`
      delete from tenant_sub_industries
      where lower(regexp_replace(trim(industry_key), '[\\s\\-]+', '_', 'g')) = ${industryKey}
    `);

    const delIndustrySubR = await tx.execute(sql`
      delete from industry_sub_industries
      where lower(regexp_replace(trim(industry_key), '[\\s\\-]+', '_', 'g')) = ${industryKey}
    `);

    const delPacksR = await tx.execute(sql`
      delete from industry_llm_packs
      where lower(regexp_replace(trim(industry_key), '[\\s\\-]+', '_', 'g')) = ${industryKey}
    `);

    const delIndustryR = await tx.execute(sql`
      delete from industries
      where lower(regexp_replace(trim(key), '[\\s\\-]+', '_', 'g')) = ${industryKey}
    `);

    // 4) Scrub onboarding AI signals (normalized match)
    const scrubSuggestedR = await tx.execute(sql`
      update tenant_onboarding
      set ai_analysis =
        coalesce(ai_analysis,'{}'::jsonb)
        - 'suggestedIndustryKey'
        - 'suggestedIndustryLabel'
        - 'needsConfirmation'
      where lower(regexp_replace(trim((ai_analysis->>'suggestedIndustryKey')::text), '[\\s\\-]+', '_', 'g')) = ${industryKey}
    `);

    const scrubRejectedR = await tx.execute(sql`
      update tenant_onboarding
      set ai_analysis = jsonb_set(
        coalesce(ai_analysis,'{}'::jsonb),
        '{rejectedIndustryKeys}',
        coalesce(
          (
            select jsonb_agg(v.value)
            from jsonb_array_elements_text(coalesce(ai_analysis->'rejectedIndustryKeys','[]'::jsonb)) v(value)
            where lower(regexp_replace(trim(v.value), '[\\s\\-]+', '_', 'g')) <> ${industryKey}
          ),
          '[]'::jsonb
        ),
        true
      )
      where exists (
        select 1
        from jsonb_array_elements_text(coalesce(ai_analysis->'rejectedIndustryKeys','[]'::jsonb)) v(value)
        where lower(regexp_replace(trim(v.value), '[\\s\\-]+', '_', 'g')) = ${industryKey}
      )
    `);

    const snapshot = {
      mode: "delete_industry",
      industryKey,
      countsBefore,
      deleted: {
        tenantSubIndustries: Number((delTenantSubR as any)?.rowCount ?? 0),
        industrySubIndustries: Number((delIndustrySubR as any)?.rowCount ?? 0),
        industryLlmPacks: Number((delPacksR as any)?.rowCount ?? 0),
        industriesRow: Number((delIndustryR as any)?.rowCount ?? 0),
      },
      scrubbed: {
        onboardingSuggestedRows: Number((scrubSuggestedR as any)?.rowCount ?? 0),
        onboardingRejectedRows: Number((scrubRejectedR as any)?.rowCount ?? 0),
      },
    };

    await auditDelete(tx, { industryKey, actor, reason, snapshot });

    return { ok: true as const, ...snapshot };
  });

  if ((result as any)?.ok === false) {
    return json(
      { ok: false, error: (result as any).error, message: (result as any).message },
      (result as any).status ?? 400
    );
  }

  return json(result, 200);
}

// Back-compat
export async function DELETE(req: Request) {
  return POST(req);
}