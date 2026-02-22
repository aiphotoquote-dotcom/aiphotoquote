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

// Postgres-side “normalize industry key” expression:
// - lowercase
// - convert any run of non-alphanumerics to underscore
// - collapse multiple underscores
// - trim leading/trailing underscores
//
// IMPORTANT: this is an SQL snippet builder, not a JS function.
function normSql(expr: any) {
  return sql`lower(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(${expr}::text,''), '[^a-zA-Z0-9]+', '_', 'g'),
        '_+',
        '_',
        'g'
      ),
      '^_|_$',
      '',
      'g'
    )
  )`;
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

    // 2) Counts before (for audit/response) — MUST use normalized comparisons (onboarding keys can be "Auto Detailing")
    const countsBeforeR = await tx.execute(sql`
      select
        (select count(*)::int from tenant_sub_industries where industry_key = ${industryKey}) as "tenantSubIndustries",
        (select count(*)::int from industry_sub_industries where industry_key = ${industryKey}) as "industrySubIndustries",
        (select count(*)::int from industry_llm_packs where industry_key = ${industryKey}) as "industryLlmPacks",
        (select count(*)::int from industries where lower(key) = ${industryKey}) as "industriesRow",

        (select count(*)::int
          from tenant_onboarding
          where ${normSql(sql`tenant_onboarding.ai_analysis->>'suggestedIndustryKey'`)} = ${industryKey}
        ) as "onboardingSuggestedRows",

        (select count(*)::int
          from tenant_onboarding
          where exists (
            select 1
            from jsonb_array_elements_text(coalesce(tenant_onboarding.ai_analysis->'rejectedIndustryKeys','[]'::jsonb)) v(value)
            where ${normSql(sql`v.value`)} = ${industryKey}
          )
        ) as "onboardingRejectedRows"
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
    //    MUST scrub where normalized(suggestedIndustryKey) == industryKey (handles "Auto Detailing", "auto-detailing", etc.)
    const scrubSuggestedR = await tx.execute(sql`
      update tenant_onboarding
      set ai_analysis =
        coalesce(ai_analysis,'{}'::jsonb)
        - 'suggestedIndustryKey'
        - 'suggestedIndustryLabel'
        - 'needsConfirmation'
      where ${normSql(sql`tenant_onboarding.ai_analysis->>'suggestedIndustryKey'`)} = ${industryKey}
    `);

    // Remove any rejectedIndustryKeys entries whose normalized value matches the industryKey.
    // Also only run where we actually have a matching element (normalized), otherwise it pointlessly rewrites json.
    const scrubRejectedR = await tx.execute(sql`
      update tenant_onboarding
      set ai_analysis = jsonb_set(
        coalesce(ai_analysis,'{}'::jsonb),
        '{rejectedIndustryKeys}',
        coalesce(
          (
            select jsonb_agg(v2.value)
            from jsonb_array_elements_text(coalesce(tenant_onboarding.ai_analysis->'rejectedIndustryKeys','[]'::jsonb)) v2(value)
            where ${normSql(sql`v2.value`)} <> ${industryKey}
          ),
          '[]'::jsonb
        ),
        true
      )
      where exists (
        select 1
        from jsonb_array_elements_text(coalesce(tenant_onboarding.ai_analysis->'rejectedIndustryKeys','[]'::jsonb)) v(value)
        where ${normSql(sql`v.value`)} = ${industryKey}
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

// ✅ Back-compat: if any UI still calls DELETE, treat it the same as POST.
export async function DELETE(req: Request) {
  return POST(req);
}