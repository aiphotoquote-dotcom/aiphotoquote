// src/app/pcc/tenants/page.tsx
import React from "react";
import Link from "next/link";
import { desc, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { appUsers, tenants, tenantSettings } from "@/lib/db/schema";
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

  const derivedStatusExpr = sql<string>`
    case
      when ${(tenants as any).archivedAt ?? (tenants as any).archived_at} is not null then 'archived'
      else coalesce(${(tenants as any).status}, 'active')
    end
  `;

  const baseRows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      ownerUserId: tenants.ownerUserId,
      ownerClerkUserId: tenants.ownerClerkUserId,
      createdAt: tenants.createdAt,

      ownerName: appUsers.name,
      ownerEmail: appUsers.email,

      status: derivedStatusExpr,
      archivedAt: (tenants as any).archivedAt ?? (tenants as any).archived_at,

      planTier: tenantSettings.planTier,
      monthlyQuoteLimit: tenantSettings.monthlyQuoteLimit,
      activationGraceCredits: tenantSettings.activationGraceCredits,
      activationGraceUsed: tenantSettings.activationGraceUsed,

      industryKey: (tenantSettings as any).industryKey ?? (tenantSettings as any).industry_key,
    })
    .from(tenants)
    .leftJoin(tenantSettings, sql`${tenantSettings.tenantId} = ${tenants.id}`)
    .leftJoin(appUsers, sql`${appUsers.id} = ${tenants.ownerUserId}`)
    .orderBy(desc(tenants.createdAt))
    .limit(200);

  const tenantIds = baseRows.map((r) => String(r.id)).filter(Boolean);

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
          i1.label::text as "confirmedIndustryLabel",
          (ob.ai_analysis->>'suggestedIndustryKey')::text as "suggestedIndustryKey",
          (ob.ai_analysis->>'suggestedIndustryLabel')::text as "suggestedIndustryLabel",
          (ob.ai_analysis->'industryInterview'->'proposedIndustry'->>'label')::text as "suggestedIndustryCanonicalLabel",
          case
            when (ob.ai_analysis->>'needsConfirmation')::text = 'true' then true
            when (ob.ai_analysis->>'needsConfirmation')::text = 't' then true
            when (ob.ai_analysis->>'needsConfirmation')::text = '1' then true
            else false
          end as "needsConfirmation",
          (ob.ai_analysis->'meta'->>'status')::text as "aiStatus",
          (ob.ai_analysis->'meta'->>'source')::text as "aiSource",
          (ob.ai_analysis->'meta'->>'updatedAt')::text as "aiUpdatedAt",
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
      console.error("[PCC] Tenants AI attach query failed", e);
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
      ownerName: safeTrim(r.ownerName) || null,
      ownerEmail: safeTrim(r.ownerEmail) || null,

      industryKey: confirmedIndustryKey,
      industryLabel: confirmedIndustryLabel,

      aiSuggestedIndustryKey: suggestedIndustryKey,
      aiSuggestedIndustryLabel: suggestedIndustryLabel,
      aiNeedsConfirmation: ai?.needsConfirmation ?? false,
      aiStatus: ai?.aiStatus ?? null,
      aiSource: ai?.aiSource ?? null,
      aiUpdatedAt: ai?.aiUpdatedAt ?? null,
      aiRejectedCount: ai?.rejectedCount ?? 0,
    };
  });

  const activeRows = rows.filter((r: any) => String(r.status ?? "active").toLowerCase() !== "archived");
  const archivedRows = rows.filter((r: any) => String(r.status ?? "").toLowerCase() === "archived");

  const activeCount = activeRows.length;
  const archivedCount = archivedRows.length;

  const needsConfirmCount = activeRows.filter((r: any) => Boolean(r.aiNeedsConfirmation)).length;

  const aiReadyCount = activeRows.filter((r: any) => {
    const aiStatus = safeTrim(r.aiStatus).toLowerCase();
    return aiStatus === "complete" && !Boolean(r.aiNeedsConfirmation);
  }).length;

  const attentionCount = activeRows.filter((r: any) => {
    const aiStatus = safeTrim(r.aiStatus).toLowerCase();
    const graceTotal = Number(r.activationGraceCredits ?? 0);
    const graceUsed = Number(r.activationGraceUsed ?? 0);
    const graceLeft = Math.max(0, graceTotal - graceUsed);

    return (
      Boolean(r.aiNeedsConfirmation) ||
      aiStatus === "error" ||
      aiStatus === "rejected" ||
      (!safeTrim(r.industryKey) && !safeTrim(r.aiSuggestedIndustryKey)) ||
      graceLeft <= 3
    );
  }).length;

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
              PCC
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
              Tenant Operations
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-300">
              Operational view of all tenant accounts, onboarding AI signals, plan state, and admin actions.
              Use <span className="font-semibold">Archive</span> to safely disable a tenant while preserving history.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
              Loaded {rows.length} {rows.length === 1 ? "tenant" : "tenants"}
            </span>

            {showArchived ? (
              <Link
                href="/pcc/tenants"
                className="rounded-full border border-gray-200 bg-white px-3 py-1.5 font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-200 dark:hover:bg-gray-950"
              >
                Hide archived
              </Link>
            ) : (
              <Link
                href="/pcc/tenants?archived=1"
                className="rounded-full border border-gray-200 bg-white px-3 py-1.5 font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-200 dark:hover:bg-gray-950"
              >
                Show archived
              </Link>
            )}
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Active
            </div>
            <div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
              {activeCount}
            </div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Non-archived tenants loaded into view
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Archived
            </div>
            <div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
              {archivedCount}
            </div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Available to show via archived toggle or filter
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              AI Ready
            </div>
            <div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
              {aiReadyCount}
            </div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Active tenants only
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Needs Confirm
            </div>
            <div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
              {needsConfirmCount}
            </div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Active tenants only
            </div>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
              Needs Attention
            </div>
            <div className="mt-2 text-2xl font-semibold text-amber-900 dark:text-amber-100">
              {attentionCount}
            </div>
            <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              Active tenants only
            </div>
          </div>
        </div>
      </div>

      <TenantsTableClient rows={rows as any} showArchived={showArchived} />
    </div>
  );
}