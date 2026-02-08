// src/app/api/pcc/industries/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rows(r: any): any[] {
  return (r as any)?.rows ?? (Array.isArray(r) ? r : []);
}

/**
 * Returns rollups for industries:
 * - confirmed tenant count (tenant_settings.industry_key)
 * - AI suggested count (tenant_onboarding.ai_analysis.suggestedIndustryKey)
 * - AI needs confirmation count (tenant_onboarding.ai_analysis.needsConfirmation)
 * - AI status breakdown
 */
export async function GET() {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  // We keep this SQL-only so it works even if drizzle schema evolves.
  const r = await db.execute(sql`
    WITH ind AS (
      SELECT
        i.key::text AS key,
        i.label::text AS label,
        i.description::text AS description,
        i.created_at AS "createdAt"
      FROM industries i
    ),

    active_tenants AS (
      SELECT id
      FROM tenants
      WHERE COALESCE(status, 'active') = 'active'
    ),

    confirmed AS (
      SELECT
        ts.industry_key::text AS key,
        COUNT(*)::int AS confirmed_count
      FROM tenant_settings ts
      JOIN active_tenants at ON at.id = ts.tenant_id
      GROUP BY ts.industry_key
    ),

    ai AS (
      SELECT
        (to.ai_analysis->>'suggestedIndustryKey')::text AS key,
        COUNT(*)::int AS ai_suggested_count,
        SUM(CASE WHEN (to.ai_analysis->>'needsConfirmation') = 'true' THEN 1 ELSE 0 END)::int AS ai_needs_confirm_count,
        SUM(CASE WHEN (to.ai_analysis->'meta'->>'status') = 'running' THEN 1 ELSE 0 END)::int AS ai_running_count,
        SUM(CASE WHEN (to.ai_analysis->'meta'->>'status') = 'error' THEN 1 ELSE 0 END)::int AS ai_error_count,
        SUM(CASE WHEN (to.ai_analysis->'meta'->>'status') = 'complete' THEN 1 ELSE 0 END)::int AS ai_complete_count,
        SUM(CASE WHEN (to.ai_analysis->>'fit') = 'good' THEN 1 ELSE 0 END)::int AS ai_fit_good_count,
        SUM(CASE WHEN (to.ai_analysis->>'fit') = 'maybe' THEN 1 ELSE 0 END)::int AS ai_fit_maybe_count,
        SUM(CASE WHEN (to.ai_analysis->>'fit') = 'poor' THEN 1 ELSE 0 END)::int AS ai_fit_poor_count
      FROM tenant_onboarding to
      JOIN active_tenants at ON at.id = to.tenant_id
      WHERE to.ai_analysis IS NOT NULL
        AND COALESCE(to.ai_analysis->>'suggestedIndustryKey','') <> ''
      GROUP BY (to.ai_analysis->>'suggestedIndustryKey')
    )

    SELECT
      ind.key,
      ind.label,
      ind.description,
      ind."createdAt",
      COALESCE(c.confirmed_count, 0)::int AS "confirmedCount",
      COALESCE(ai.ai_suggested_count, 0)::int AS "aiSuggestedCount",
      COALESCE(ai.ai_needs_confirm_count, 0)::int AS "aiNeedsConfirmCount",
      COALESCE(ai.ai_running_count, 0)::int AS "aiRunningCount",
      COALESCE(ai.ai_error_count, 0)::int AS "aiErrorCount",
      COALESCE(ai.ai_complete_count, 0)::int AS "aiCompleteCount",
      COALESCE(ai.ai_fit_good_count, 0)::int AS "aiFitGoodCount",
      COALESCE(ai.ai_fit_maybe_count, 0)::int AS "aiFitMaybeCount",
      COALESCE(ai.ai_fit_poor_count, 0)::int AS "aiFitPoorCount"
    FROM ind
    LEFT JOIN confirmed c ON c.key = ind.key
    LEFT JOIN ai ON ai.key = ind.key
    ORDER BY ind.label ASC
  `);

  return NextResponse.json({ ok: true, industries: rows(r) });
}