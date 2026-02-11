// src/app/pcc/tenants/page.tsx
import React from "react";
import Link from "next/link";
import { desc, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants, tenantSettings } from "@/lib/db/schema";
import { requirePlatformRole } from "@/lib/rbac/guards";
import TenantsTableClient from "./TenantsTableClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
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

export default async function PccTenantsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const sp = (await props.searchParams) ?? {};
  const showArchived =
    sp.archived === "1" ||
    sp.archived === "true" ||
    (Array.isArray(sp.archived) && sp.archived.includes("1"));

  // Base tenant rows (existing behavior)
  const baseRows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      ownerUserId: tenants.ownerUserId,
      ownerClerkUserId: tenants.ownerClerkUserId,
      createdAt: tenants.createdAt,

      status: sql<string>`coalesce(${(tenants as any).status}, 'active')`,
      archivedAt: (tenants as any).archivedAt ?? (tenants as any).archived_at,

      planTier: tenantSettings.planTier,
      monthlyQuoteLimit: tenantSettings.monthlyQuoteLimit,
      activationGraceCredits: tenantSettings.activationGraceCredits,
      activationGraceUsed: tenantSettings.activationGraceUsed,

      // confirmed industry from settings (handle snake/camel)
      industryKey: (tenantSettings as any).industryKey ?? (tenantSettings as any).industry_key,
    })
    .from(tenants)
    .leftJoin(tenantSettings, sql`${tenantSettings.tenantId} = ${tenants.id}`)
    .where(showArchived ? sql`true` : sql`coalesce(${(tenants as any).status}, 'active') <> 'archived'`)
    .orderBy(desc(tenants.createdAt))
    .limit(200);

  const tenantIds = baseRows.map((r) => String(r.id)).filter(Boolean);

  // AI attach map (best-effort)
  const aiByTenant = new Map<
    string,
    {
      suggestedIndustryKey: string | null;
      suggestedIndustryLabel: string | null;
      needsConfirmation: boolean;
      aiStatus: string | null;
      aiSource: string | null;
      aiUpdatedAt: string | null;
      rejectedCount: number;
      confirmedIndustryLabel: string | null;
      suggestedIndustryCanonicalLabel: string | null;
    }
  >();

  if (tenantIds.length) {
    // Build a real uuid[] expression: array['..'::uuid, '..'::uuid]::uuid[]
    const uuidArray = sql`array[${sql.join(
      tenantIds.map((id) => sql`${id}::uuid`),
      sql`, `
    )}]::uuid[]`;

    try {
      const r = await db.execute(sql`
        with visible as (
          select unnest(${uuidArray}) as tenant_id
        )
        select
          v.tenant_id::text as "tenantId",

          -- confirmed industry label (industries table)
          i1.label::text as "confirmedIndustryLabel",

          -- suggested industry key
          (ob.ai_analysis->>'suggestedIndustryKey')::text as "suggestedIndustryKey",

          -- suggested industry label candidates
          (ob.ai_analysis->>'suggestedIndustryLabel')::text as "suggestedIndustryLabel",
          (ob.ai_analysis->'industryInterview'->'proposedIndustry'->>'label')::text as "suggestedIndustryCanonicalLabel",

          -- confirmation state
          case
            when (ob.ai_analysis->>'needsConfirmation')::text = 'true' then true
            when (ob.ai_analysis->>'needsConfirmation')::text = 't' then true
            when (ob.ai_analysis->>'needsConfirmation')::text = '1' then true
            else false
          end as "needsConfirmation",

          -- meta/status/source/updatedAt
          (ob.ai_analysis->'meta'->>'status')::text as "aiStatus",
          (ob.ai_analysis->'meta'->>'source')::text as "aiSource",
          (ob.ai_analysis->'meta'->>'updatedAt')::text as "aiUpdatedAt",

          -- rejected keys count
          coalesce(jsonb_array_length(coalesce(ob.ai_analysis->'rejectedIndustryKeys','[]'::jsonb)), 0)::int as "rejectedCount"
        from visible v
        left join tenant_onboarding ob on ob.tenant_id = v.tenant_id
        left join tenant_settings ts on ts.tenant_id = v.tenant_id
        left join industries i1 on i1.key = ts.industry_key
      `);

      const rows = (r as any)?.rows ?? (Array.isArray(r) ? r : []);
      for (const x of rows) {
        const tid = String(x.tenantId ?? "");
        if (!tid) continue;

        aiByTenant.set(tid, {
          suggestedIndustryKey: x.suggestedIndustryKey ? String(x.suggestedIndustryKey) : null,
          suggestedIndustryLabel: x.suggestedIndustryLabel ? String(x.suggestedIndustryLabel) : null,
          suggestedIndustryCanonicalLabel: x.suggestedIndustryCanonicalLabel ? String(x.suggestedIndustryCanonicalLabel) : null,
          needsConfirmation: Boolean(x.needsConfirmation),
          aiStatus: x.aiStatus ? String(x.aiStatus) : null,
          aiSource: x.aiSource ? String(x.aiSource) : null,
          aiUpdatedAt: x.aiUpdatedAt ? String(x.aiUpdatedAt) : null,
          rejectedCount: Number(x.rejectedCount ?? 0),
          confirmedIndustryLabel: x.confirmedIndustryLabel ? String(x.confirmedIndustryLabel) : null,
        });
      }
    } catch (e: any) {
      // ✅ This is the key: Vercel logs will show the real DB error
      console.error("[PCC] Tenants AI attach query failed", e);
      // We intentionally continue with baseRows only
    }
  }

  const rows = baseRows.map((r: any) => {
    const tid = String(r.id);
    const ai = aiByTenant.get(tid);

    const confirmedIndustryKey = r.industryKey ? String(r.industryKey) : null;
    const confirmedIndustryLabel =
      ai?.confirmedIndustryLabel || (confirmedIndustryKey ? titleFromKey(confirmedIndustryKey) : null);

    const suggestedIndustryKey = ai?.suggestedIndustryKey ?? null;
    const suggestedIndustryLabel =
      ai?.suggestedIndustryCanonicalLabel ||
      ai?.suggestedIndustryLabel ||
      (suggestedIndustryKey ? titleFromKey(suggestedIndustryKey) : null);

    return {
      ...r,

      // confirmed industry (settings)
      industryKey: confirmedIndustryKey,
      industryLabel: confirmedIndustryLabel,

      // AI suggestion signals
      aiSuggestedIndustryKey: suggestedIndustryKey,
      aiSuggestedIndustryLabel: suggestedIndustryLabel,
      aiNeedsConfirmation: ai?.needsConfirmation ?? false,
      aiStatus: ai?.aiStatus ?? null,
      aiSource: ai?.aiSource ?? null,
      aiUpdatedAt: ai?.aiUpdatedAt ?? null,
      aiRejectedCount: ai?.rejectedCount ?? 0,
    };
  });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Tenants</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              PCC tenant list. Use <span className="font-semibold">Archive</span> to safely disable a tenant while preserving history (no data is deleted).
              <span className="ml-2">
                Includes <span className="font-semibold">AI onboarding signals</span> (suggested industry, needs-confirm, status).
              </span>
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1 dark:border-gray-800 dark:bg-gray-900">
                Showing {rows.length} {rows.length === 1 ? "tenant" : "tenants"}
              </span>

              {showArchived ? (
                <Link
                  href="/pcc/tenants"
                  className="rounded-full border border-gray-200 bg-white px-2 py-1 font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-200 dark:hover:bg-gray-950"
                >
                  Hide archived
                </Link>
              ) : (
                <Link
                  href="/pcc/tenants?archived=1"
                  className="rounded-full border border-gray-200 bg-white px-2 py-1 font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-200 dark:hover:bg-gray-950"
                >
                  Show archived
                </Link>
              )}

              {!showArchived ? <span className="text-gray-400 dark:text-gray-500">Archived tenants hidden by default</span> : null}
            </div>
          </div>
        </div>
      </div>

      <TenantsTableClient rows={rows as any} showArchived={showArchived} />
    </div>
  );
}