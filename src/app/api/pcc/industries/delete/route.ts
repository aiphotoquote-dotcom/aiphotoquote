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

  const industryKey = safeLower(parsed.data.industryKey);
  const reason = safeTrim(parsed.data.reason ?? "") || null;

  if (!industryKey) return json({ ok: false, error: "BAD_REQUEST", message: "industryKey is required" }, 400);

  const actor = actorFromReq(req);

  const result = await db.transaction(async (tx) => {
    // 1) Block if confirmed tenants are still assigned to this key.
    const tenantCountR = await tx.execute(sql`
      select count(*)::int as "n"
      from tenant_settings
      where industry_key = ${industryKey}
    `);
    const nTenants = Number((tenantCountR as any)?.rows?.[0]?.n ?? 0);
    if (nTenants > 0) {
      return {
        ok: false as const,
        status: 409,
        error: "HAS_TENANTS",
        message: `Cannot delete: ${nTenants} tenants still assigned (tenant_settings.industry_key).`,
      };
    }

    // 2) Counts before (for audit/response)
    const countsBeforeR = await tx.execute(sql`
      select
        (select count(*)::int from tenant_sub_industries where industry_key = ${industryKey}) as "tenantSubIndustries",
        (select count(*)::int from industry_sub_industries where industry_key = ${industryKey}) as "industrySubIndustries",
        (select count(*)::int from industry_llm_packs where industry_key = ${industryKey}) as "industryLlmPacks",
        (select count(*)::int from industries where lower(key) = ${industryKey}) as "industriesRow",
        (select count(*)::int from tenant_onboarding where (ai_analysis->>'suggestedIndustryKey')::text = ${industryKey}) as "onboardingSuggestedRows",
        (select count(*)::int from tenant_onboarding where coalesce(ai_analysis->'rejectedIndustryKeys','[]'::jsonb) ? ${industryKey}) as "onboardingRejectedRows"
    `);
    const countsBefore: any = (countsBeforeR as any)?.rows?.[0] ?? {};

    // 3) Delete platform artifacts for this key (works for derived + canonical)
    const delTenantSubR = await tx.execute(sql`
      delete from tenant_sub_industries
      where industry_key = ${industryKey}
    `);

    const delIndustrySubR = await tx.execute(sql`
      delete from industry_sub_industries
      where industry_key = ${industryKey}
    `);

    const delPacksR = await tx.execute(sql`
      delete from industry_llm_packs
      where industry_key = ${industryKey}
    `);

    // If it exists, delete the canonical row too. If not, no-op.
    const delIndustryR = await tx.execute(sql`
      delete from industries
      where lower(key) = ${industryKey}
    `);

    // 4) Scrub onboarding AI signals so it disappears from the derived list immediately.
    //    (Does NOT prevent future rediscovery by new onboardings.)
    const scrubSuggestedR = await tx.execute(sql`
      update tenant_onboarding
      set ai_analysis =
        coalesce(ai_analysis,'{}'::jsonb)
        - 'suggestedIndustryKey'
        - 'suggestedIndustryLabel'
        - 'needsConfirmation'
      where (ai_analysis->>'suggestedIndustryKey')::text = ${industryKey}
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
            where v.value <> ${industryKey}
          ),
          '[]'::jsonb
        ),
        true
      )
      where coalesce(ai_analysis->'rejectedIndustryKeys','[]'::jsonb) ? ${industryKey}
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

    return { ok: true as const, industryKey, ...snapshot };
  });

  if ((result as any)?.ok === false) {
    return json(
      { ok: false, error: (result as any).error, message: (result as any).message },
      (result as any).status ?? 400
    );
  }

  return json(result, 200);
}