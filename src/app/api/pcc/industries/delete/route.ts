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

function safeLower(v: unknown) {
  return safeTrim(v).toLowerCase();
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

function getRows(r: any): any[] {
  return (r as any)?.rows ?? (Array.isArray(r) ? r : []);
}
function firstRow(r: any) {
  return getRows(r)[0] ?? null;
}

/**
 * Normalize keys for robust matching:
 * - lower()
 * - remove ALL whitespace (spaces/tabs/newlines/etc)
 *
 * Postgres btrim/trim do NOT remove \n or \t by default.
 */
function normSql(v: any) {
  // v is a SQL expression (column or json extract)
  return sql`lower(regexp_replace(coalesce(${v}::text,''), '\\s+', '', 'g'))`;
}

async function auditDelete(tx: any, args: { industryKey: string; actor: string; reason: string | null; snapshot: any }) {
  const snapshotJson = jsonbString(args.snapshot);
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

  // "industryKey" coming in should already be canonical-ish (snake_case),
  // but normalize anyway.
  const industryKey = safeLower(parsed.data.industryKey).replace(/\s+/g, "");
  const reason = safeTrim(parsed.data.reason ?? "") || null;

  if (!industryKey) return json({ ok: false, error: "BAD_REQUEST", message: "industryKey is required" }, 400);

  const actor = actorFromReq(req);

  const result = await db.transaction(async (tx) => {
    // 1) Block if any tenants are still assigned (robust match)
    const tenantCountR = await tx.execute(sql`
      select count(*)::int as "n"
      from tenant_settings
      where ${normSql(sql`tenant_settings.industry_key`)} = ${industryKey}
    `);
    const nTenants = Number(firstRow(tenantCountR)?.n ?? 0);
    if (nTenants > 0) {
      return {
        ok: false as const,
        status: 409,
        error: "HAS_TENANTS",
        message: `Cannot delete: ${nTenants} tenants still assigned (tenant_settings.industry_key).`,
      };
    }

    // 2) Counts before (ALWAYS returns 1 row)
    const countsBeforeR = await tx.execute(sql`
      select
        (select count(*)::int from tenant_sub_industries where ${normSql(sql`tenant_sub_industries.industry_key`)} = ${industryKey}) as "tenantSubIndustries",
        (select count(*)::int from industry_sub_industries where ${normSql(sql`industry_sub_industries.industry_key`)} = ${industryKey}) as "industrySubIndustries",
        (select count(*)::int from industry_llm_packs where ${normSql(sql`industry_llm_packs.industry_key`)} = ${industryKey}) as "industryLlmPacks",
        (select count(*)::int from industries where ${normSql(sql`industries.key`)} = ${industryKey}) as "industriesRow",
        (select count(*)::int from tenant_onboarding where ${normSql(sql`(tenant_onboarding.ai_analysis->>'suggestedIndustryKey')`)} = ${industryKey}) as "onboardingSuggestedRows",
        (select count(*)::int
           from tenant_onboarding ob
           where exists (
             select 1
             from jsonb_array_elements_text(coalesce(ob.ai_analysis->'rejectedIndustryKeys','[]'::jsonb)) v(value)
             where ${normSql(sql`v.value`)} = ${industryKey}
           )
        ) as "onboardingRejectedRows"
    `);
    const countsBefore = firstRow(countsBeforeR) ?? {};

    // 3) Delete platform artifacts (robust match)
    const delTenantSubR = await tx.execute(sql`
      delete from tenant_sub_industries
      where ${normSql(sql`tenant_sub_industries.industry_key`)} = ${industryKey}
    `);

    const delIndustrySubR = await tx.execute(sql`
      delete from industry_sub_industries
      where ${normSql(sql`industry_sub_industries.industry_key`)} = ${industryKey}
    `);

    const delPacksR = await tx.execute(sql`
      delete from industry_llm_packs
      where ${normSql(sql`industry_llm_packs.industry_key`)} = ${industryKey}
    `);

    const delIndustryR = await tx.execute(sql`
      delete from industries
      where ${normSql(sql`industries.key`)} = ${industryKey}
    `);

    // 4) Scrub onboarding suggested
    const scrubSuggestedR = await tx.execute(sql`
      update tenant_onboarding
      set ai_analysis =
        coalesce(ai_analysis,'{}'::jsonb)
        - 'suggestedIndustryKey'
        - 'suggestedIndustryLabel'
        - 'needsConfirmation'
      where ${normSql(sql`(tenant_onboarding.ai_analysis->>'suggestedIndustryKey')`)} = ${industryKey}
    `);

    // 5) Scrub onboarding rejected keys (robust match)
    const scrubRejectedR = await tx.execute(sql`
      update tenant_onboarding ob
      set ai_analysis = jsonb_set(
        coalesce(ob.ai_analysis,'{}'::jsonb),
        '{rejectedIndustryKeys}',
        coalesce(
          (
            select jsonb_agg(v.value)
            from jsonb_array_elements_text(coalesce(ob.ai_analysis->'rejectedIndustryKeys','[]'::jsonb)) v(value)
            where ${normSql(sql`v.value`)} <> ${industryKey}
          ),
          '[]'::jsonb
        ),
        true
      )
      where exists (
        select 1
        from jsonb_array_elements_text(coalesce(ob.ai_analysis->'rejectedIndustryKeys','[]'::jsonb)) v(value)
        where ${normSql(sql`v.value`)} = ${industryKey}
      )
    `);

    // Helpful debug: what exact strings existed that matched (if any)
    const debugSuggestedValsR = await tx.execute(sql`
      select distinct (ai_analysis->>'suggestedIndustryKey')::text as "value"
      from tenant_onboarding
      where ${normSql(sql`(tenant_onboarding.ai_analysis->>'suggestedIndustryKey')`)} = ${industryKey}
      limit 10
    `);
    const debugRejectedValsR = await tx.execute(sql`
      select distinct v.value::text as "value"
      from tenant_onboarding ob
      cross join lateral jsonb_array_elements_text(coalesce(ob.ai_analysis->'rejectedIndustryKeys','[]'::jsonb)) v(value)
      where ${normSql(sql`v.value`)} = ${industryKey}
      limit 10
    `);

    const snapshot = {
      mode: "delete_industry",
      industryKey,
      countsBefore,
      deleted: {
        tenantSubIndustries: Number((delTenantSubR as any)?.rowCount ?? getRows(delTenantSubR).length ?? 0),
        industrySubIndustries: Number((delIndustrySubR as any)?.rowCount ?? getRows(delIndustrySubR).length ?? 0),
        industryLlmPacks: Number((delPacksR as any)?.rowCount ?? getRows(delPacksR).length ?? 0),
        industriesRow: Number((delIndustryR as any)?.rowCount ?? getRows(delIndustryR).length ?? 0),
      },
      scrubbed: {
        onboardingSuggestedRows: Number((scrubSuggestedR as any)?.rowCount ?? getRows(scrubSuggestedR).length ?? 0),
        onboardingRejectedRows: Number((scrubRejectedR as any)?.rowCount ?? getRows(scrubRejectedR).length ?? 0),
      },
      debugMatched: {
        suggestedValues: getRows(debugSuggestedValsR).map((x: any) => String(x.value ?? "")),
        rejectedValues: getRows(debugRejectedValsR).map((x: any) => String(x.value ?? "")),
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

export async function DELETE(req: Request) {
  return POST(req);
}