// src/app/pcc/industries/[industryKey]/page.tsx

import React from "react";
import Link from "next/link";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";

import IndustryPromptPackEditor from "./IndustryPromptPackEditor";
import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";

import {
  rows,
  firstRow,
  fmtDate,
  toBool,
  toNum,
  safeTrim,
  titleFromKey,
  safeJsonParse,
  pick,
  normalizeUrl,
  asStringArray,
  isPlainObject,
  mergeEditorPacks,
  packObjToEditorPack,
  type EditorPack,
} from "./pccIndustryUtils";

import IndustryHeaderCard from "./IndustryHeaderCard";
import ConfirmedTenantsSection from "./ConfirmedTenantsSection";
import AiSuggestedTenantsSection from "./AiSuggestedTenantsSection";
import RejectedTenantsSection from "./RejectedTenantsSection";
import DefaultSubIndustriesSection from "./DefaultSubIndustriesSection";
import TenantOverridesSection from "./TenantOverridesSection";

import GenerateIndustryPackButton from "./GenerateIndustryPackButton";
import MergeIndustryButton from "./MergeIndustryButton";
import DeleteIndustryButton from "./DeleteIndustryButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ industryKey: string }>;
  searchParams?: Promise<{ showInactive?: string }>;
};

async function loadLatestDbIndustryPack(industryKeyLower: string) {
  const r = await db.execute(sql`
    select
      industry_key::text as "industryKey",
      enabled as "enabled",
      version::int as "version",
      pack as "pack",
      models as "models",
      prompts as "prompts",
      updated_at as "updatedAt"
    from industry_llm_packs
    where industry_key = ${industryKeyLower}
      and enabled = true
    order by version desc, updated_at desc
    limit 1
  `);

  const row = firstRow(r);
  if (!row) return null;

  // jsonb may come back as string in some runtime paths
  const packVal = safeJsonParse(row.pack);
  const modelsVal = safeJsonParse(row.models);
  const promptsVal = safeJsonParse(row.prompts);

  const packObj = isPlainObject(packVal)
    ? packVal
    : {
        ...(isPlainObject(modelsVal) ? { models: modelsVal } : {}),
        ...(isPlainObject(promptsVal) ? { prompts: promptsVal } : {}),
      };

  return {
    industryKey: String(row.industryKey ?? industryKeyLower),
    version: toNum(row.version, 0),
    updatedAt: row.updatedAt ?? null,
    packObj,
  };
}

export default async function PccIndustryDetailPage(props: Props) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

  const p = await props.params;
  const sp = (await props.searchParams) ?? {};
  const showInactive = toBool(sp?.showInactive);

  const industryKey = p?.industryKey;
  const key = decodeURIComponent(industryKey || "").trim();

  if (!key) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Industry not found</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Missing industry key.</p>
          <div className="mt-4">
            <Link
              href="/pcc/industries"
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
            >
              Back to industries
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const industryKeyLower = String(key).toLowerCase();

  // -----------------------------------
  // Packs (platform override + DB latest)
  // -----------------------------------
  const pcc = await loadPlatformLlmConfig();
  const platformPackRaw = (pcc?.prompts?.industryPromptPacks ?? {})[industryKeyLower] ?? null;

  const dbLatest = await loadLatestDbIndustryPack(industryKeyLower);
  const dbEditorPack = dbLatest ? packObjToEditorPack(industryKeyLower, dbLatest.packObj) : null;

  const platformEditorPack: EditorPack | null = platformPackRaw
    ? {
        quoteEstimatorSystem: safeTrim(platformPackRaw.quoteEstimatorSystem) || undefined,
        qaQuestionGeneratorSystem: safeTrim(platformPackRaw.qaQuestionGeneratorSystem) || undefined,
        extraSystemPreamble: safeTrim(platformPackRaw.extraSystemPreamble) || undefined,
        renderSystemAddendum:
          safeTrim(platformPackRaw.renderSystemAddendum) ||
          safeTrim((platformPackRaw as any).renderPromptAddendum) ||
          undefined,
        renderNegativeGuidance: safeTrim(platformPackRaw.renderNegativeGuidance) || undefined,
      }
    : null;

  const initialEditorPack = mergeEditorPacks(dbEditorPack, platformEditorPack);

  // -----------------------------
  // Industry metadata
  // -----------------------------
  const industryR = await db.execute(sql`
    select
      id::text as "id",
      key::text as "key",
      label::text as "label",
      description::text as "description",
      created_at as "createdAt"
    from industries
    where key = ${key}
    limit 1
  `);

  const industryRow = firstRow(industryR);

  const industry = {
    key,
    label: industryRow?.label ? String(industryRow.label) : titleFromKey(key) || key,
    description: industryRow?.description ? String(industryRow.description) : null,
    createdAt: industryRow?.createdAt ?? null,
    isCanonical: Boolean(industryRow?.key),
  };

  // -----------------------------
  // Confirmed tenants
  // -----------------------------
  const confirmedR = await db.execute(sql`
    select
      t.id::text as "tenantId",
      t.name::text as "name",
      t.slug::text as "slug",
      t.status::text as "tenantStatus",
      t.created_at as "createdAt",

      ts.plan_tier::text as "planTier",
      ts.monthly_quote_limit as "monthlyQuoteLimit",
      ts.activation_grace_credits as "graceTotal",
      ts.activation_grace_used as "graceUsed",
      ts.updated_at as "settingsUpdatedAt",

      ts.brand_logo_url::text as "brandLogoUrl"
    from tenant_settings ts
    join tenants t on t.id = ts.tenant_id
    where ts.industry_key = ${key}
    order by t.created_at desc
    limit 500
  `);

  const confirmed = rows(confirmedR).map((r: any) => {
    const graceTotal = toNum(r.graceTotal, 0);
    const graceUsed = toNum(r.graceUsed, 0);
    return {
      tenantId: String(r.tenantId),
      name: String(r.name ?? ""),
      slug: String(r.slug ?? ""),
      tenantStatus: String(r.tenantStatus ?? "active"),
      createdAt: r.createdAt ?? null,

      planTier: String(r.planTier ?? "tier0"),
      monthlyQuoteLimit: r.monthlyQuoteLimit === null || r.monthlyQuoteLimit === undefined ? null : toNum(r.monthlyQuoteLimit),
      graceTotal,
      graceUsed,
      graceRemaining: Math.max(0, graceTotal - graceUsed),
      settingsUpdatedAt: r.settingsUpdatedAt ?? null,

      brandLogoUrl: r.brandLogoUrl ? String(r.brandLogoUrl) : null,
    };
  });

  const confirmedIds = new Set(confirmed.map((t: any) => t.tenantId));

  // -----------------------------
  // AI suggested tenants
  // -----------------------------
  const aiR = await db.execute(sql`
    select
      t.id::text as "tenantId",
      t.name::text as "name",
      t.slug::text as "slug",
      t.status::text as "tenantStatus",
      t.created_at as "createdAt",

      ob.website::text as "website",
      ob.ai_analysis as "aiAnalysis",

      (ob.ai_analysis->>'businessGuess')::text as "businessGuess",
      (ob.ai_analysis->>'suggestedIndustryLabel')::text as "suggestedIndustryLabel",
      (ob.ai_analysis->>'fit')::text as "fit",
      (ob.ai_analysis->>'confidenceScore')::text as "confidenceScore",
      (ob.ai_analysis->>'needsConfirmation')::text as "needsConfirmation",

      (ob.ai_analysis->'meta'->>'status')::text as "aiStatus",
      (ob.ai_analysis->'meta'->>'source')::text as "aiSource",
      (ob.ai_analysis->'meta'->>'previousSuggestedIndustryKey')::text as "aiPrevSuggested",

      (ob.ai_analysis->'meta'->>'round')::text as "aiRound",
      (ob.ai_analysis->'meta'->>'updatedAt')::text as "aiUpdatedAt",
      (ob.ai_analysis->'meta'->'model'->>'name')::text as "aiModel",

      (ob.ai_analysis->'industryInterview'->'meta'->'debug'->>'reason')::text as "aiReason",
      (ob.ai_analysis->'industryInterview'->'proposedIndustry'->>'label')::text as "proposedLabel"
    from tenant_onboarding ob
    join tenants t on t.id = ob.tenant_id
    where (ob.ai_analysis->>'suggestedIndustryKey') = ${key}
      and not (coalesce(ob.ai_analysis->'rejectedIndustryKeys','[]'::jsonb) ? ${key})
    order by t.created_at desc
    limit 500
  `);

  const aiSuggestedAll = rows(aiR).map((r: any) => {
    const aiObj = safeJsonParse(r.aiAnalysis);

    const rejectedKeys = asStringArray(pick(aiObj, ["rejectedIndustryKeys"]));

    const candidateLabels =
      (Array.isArray(pick(aiObj, ["industryInterview.candidates"])) ? pick(aiObj, ["industryInterview.candidates"]) : null) ?? [];

    const topCandidates = Array.isArray(candidateLabels)
      ? candidateLabels
          .map((c: any) => ({
            label: safeTrim(c?.label),
            key: safeTrim(c?.key),
            score: toNum(c?.score, 0),
          }))
          .filter((x: any) => x.label && x.key)
          .slice(0, 4)
      : [];

    const website = normalizeUrl(r.website ? String(r.website) : null);

    const suggestedLabel =
      safeTrim(r.proposedLabel) ||
      safeTrim(r.suggestedIndustryLabel) ||
      safeTrim(pick(aiObj, ["suggestedIndustryLabel"])) ||
      safeTrim(pick(aiObj, ["industryInterview.proposedIndustry.label"])) ||
      "";

    const reason =
      safeTrim(r.aiReason) ||
      safeTrim(pick(aiObj, ["industryInterview.meta.debug.reason"])) ||
      safeTrim(pick(aiObj, ["meta.debug.reason"])) ||
      "";

    const model =
      safeTrim(r.aiModel) ||
      safeTrim(pick(aiObj, ["meta.model.name"])) ||
      safeTrim(pick(aiObj, ["industryInterview.meta.model.name"])) ||
      "";

    const updatedAt =
      safeTrim(r.aiUpdatedAt) ||
      safeTrim(pick(aiObj, ["meta.updatedAt"])) ||
      safeTrim(pick(aiObj, ["industryInterview.meta.updatedAt"])) ||
      "";

    const aiStatus =
      safeTrim(r.aiStatus) ||
      safeTrim(pick(aiObj, ["meta.status"])) ||
      safeTrim(pick(aiObj, ["industryInterview.meta.status"])) ||
      "";

    const aiSource = safeTrim(r.aiSource) || safeTrim(pick(aiObj, ["meta.source"])) || "";
    const aiPrevSuggested = safeTrim(r.aiPrevSuggested) || safeTrim(pick(aiObj, ["meta.previousSuggestedIndustryKey"])) || "";

    return {
      tenantId: String(r.tenantId),
      name: String(r.name ?? ""),
      slug: String(r.slug ?? ""),
      tenantStatus: String(r.tenantStatus ?? "active"),
      createdAt: r.createdAt ?? null,

      website,
      businessGuess: r.businessGuess ? String(r.businessGuess) : null,
      suggestedLabel: suggestedLabel || null,

      fit: r.fit ? String(r.fit) : null,
      confidenceScore: toNum(r.confidenceScore, 0),
      needsConfirmation: toBool(r.needsConfirmation),

      aiStatus: aiStatus || null,
      aiSource: aiSource || null,
      aiPrevSuggested: aiPrevSuggested || null,

      aiRound: r.aiRound ? toNum(r.aiRound, 0) : null,

      aiUpdatedAt: updatedAt || null,
      aiModel: model || null,
      aiReason: reason || null,

      rejectedIndustryKeys: rejectedKeys,
      topCandidates,
    };
  });

  const aiUnconfirmed = aiSuggestedAll.filter((t: any) => !confirmedIds.has(t.tenantId));
  const aiAlsoConfirmed = aiSuggestedAll.filter((t: any) => confirmedIds.has(t.tenantId));

  // -----------------------------
  // Rejected tenants
  // -----------------------------
  const rejectedR = await db.execute(sql`
    select
      t.id::text as "tenantId",
      t.name::text as "name",
      t.slug::text as "slug",
      t.status::text as "tenantStatus",
      t.created_at as "createdAt",

      ob.website::text as "website",
      (ob.ai_analysis->'meta'->>'status')::text as "aiStatus",
      (ob.ai_analysis->'meta'->>'source')::text as "aiSource",
      (ob.ai_analysis->'meta'->>'updatedAt')::text as "aiUpdatedAt"
    from tenant_onboarding ob
    join tenants t on t.id = ob.tenant_id
    where coalesce(ob.ai_analysis->'rejectedIndustryKeys','[]'::jsonb) ? ${key}
    order by t.created_at desc
    limit 200
  `);

  const rejectedTenants = rows(rejectedR).map((r: any) => ({
    tenantId: String(r.tenantId),
    name: String(r.name ?? ""),
    slug: String(r.slug ?? ""),
    tenantStatus: String(r.tenantStatus ?? "active"),
    createdAt: r.createdAt ?? null,
    website: normalizeUrl(r.website ? String(r.website) : null),
    aiStatus: r.aiStatus ? String(r.aiStatus) : null,
    aiSource: r.aiSource ? String(r.aiSource) : null,
    aiUpdatedAt: r.aiUpdatedAt ? String(r.aiUpdatedAt) : null,
  }));

  // -----------------------------
  // Default sub-industries (global)
  // -----------------------------
  const defaultsR = await db.execute(sql`
    select
      isi.id::text as "id",
      isi.industry_key::text as "industryKey",
      isi.key::text as "subKey",
      isi.label::text as "subLabel",
      isi.description::text as "description",
      isi.sort_order::int as "sortOrder",
      isi.is_active as "isActive",
      isi.created_at as "createdAt",
      isi.updated_at as "updatedAt",
      coalesce(ov."inUseCount", 0)::int as "inUseCount"
    from industry_sub_industries isi
    left join (
      select
        tsi.key::text as "subKey",
        count(distinct tsi.tenant_id)::int as "inUseCount"
      from tenant_sub_industries tsi
      join tenant_settings ts on ts.tenant_id = tsi.tenant_id
      where ts.industry_key = ${key}
        and tsi.industry_key = ${key}
      group by tsi.key
    ) ov on ov."subKey" = isi.key
    where isi.industry_key = ${key}
    order by isi.sort_order asc, isi.label asc
    limit 500
  `);

  const defaultSubIndustriesAll = rows(defaultsR).map((r: any) => ({
    id: String(r.id ?? ""),
    industryKey: String(r.industryKey ?? key),
    subKey: String(r.subKey ?? ""),
    subLabel: String(r.subLabel ?? ""),
    description: r.description ? String(r.description) : null,
    sortOrder: toNum(r.sortOrder, 1000),
    isActive: toBool(r.isActive),
    createdAt: r.createdAt ?? null,
    updatedAt: r.updatedAt ?? null,
    inUseCount: toNum(r.inUseCount, 0),
  }));

  const defaultSubIndustries = showInactive ? defaultSubIndustriesAll : defaultSubIndustriesAll.filter((s) => s.isActive);
  const inactiveCount = defaultSubIndustriesAll.filter((s) => !s.isActive).length;

  // -----------------------------
  // Tenant overrides (summary)
  // -----------------------------
  const overridesR = await db.execute(sql`
    select
      tsi.key::text as "subKey",
      tsi.label::text as "subLabel",
      count(distinct tsi.tenant_id)::int as "tenantCount"
    from tenant_sub_industries tsi
    join tenant_settings ts on ts.tenant_id = tsi.tenant_id
    where ts.industry_key = ${key}
      and tsi.industry_key = ${key}
    group by tsi.key, tsi.label
    order by count(distinct tsi.tenant_id) desc, tsi.label asc
    limit 100
  `);

  const overrides = rows(overridesR).map((r: any) => ({
    subKey: String(r.subKey ?? ""),
    subLabel: String(r.subLabel ?? ""),
    tenantCount: toNum(r.tenantCount, 0),
  }));

  // -----------------------------
  // Derived counts for header
  // -----------------------------
  const confirmedCount = confirmed.length;
  const aiSuggestedCount = aiSuggestedAll.length;
  const aiUnconfirmedCount = aiUnconfirmed.length;

  const needsConfirmCount = aiSuggestedAll.filter((x: any) => x.needsConfirmation).length;
  const runningCount = aiSuggestedAll.filter((x: any) => String(x.aiStatus ?? "").toLowerCase() === "running").length;
  const errorCount = aiSuggestedAll.filter((x: any) => String(x.aiStatus ?? "").toLowerCase() === "error").length;

  // ✅ Force editor to remount when db pack version changes
  const editorKey = `industry-pack:${industryKeyLower}:v${dbLatest?.version ?? 0}`;

  const dbBadge = dbLatest ? { version: dbLatest.version, updatedAt: dbLatest.updatedAt } : null;

  return (
    <div className="space-y-6">
      <IndustryPromptPackEditor key={editorKey} industryKey={industryKeyLower} initialPack={initialEditorPack as any} />

      {/* Action row (kept outside header card to avoid changing your card internals) */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <GenerateIndustryPackButton industryKey={industryKeyLower} industryLabel={industry.label} industryDescription={industry.description} />
        <MergeIndustryButton sourceKey={industryKeyLower} />
        <DeleteIndustryButton industryKey={industryKeyLower} />
      </div>

      <IndustryHeaderCard
        industry={industry}
        industryKeyLower={industryKeyLower}
        dbLatest={dbBadge}
        counts={{
          confirmedCount,
          aiSuggestedCount,
          needsConfirmCount,
          runningCount,
          errorCount,
          aiUnconfirmedCount,
          rejectedCount: rejectedTenants.length,
        }}
        fmtDate={fmtDate}
      />

      <ConfirmedTenantsSection confirmed={confirmed} fmtDate={fmtDate} />

      <AiSuggestedTenantsSection
        industryKey={key}
        aiUnconfirmed={aiUnconfirmed}
        aiAlsoConfirmed={aiAlsoConfirmed}
        rejectedCount={rejectedTenants.length}
        fmtDate={fmtDate}
      />

      <RejectedTenantsSection industryKey={key} rejectedTenants={rejectedTenants} fmtDate={fmtDate} />

      <DefaultSubIndustriesSection
        industryKey={key}
        showInactive={showInactive}
        inactiveCount={inactiveCount}
        defaultSubIndustries={defaultSubIndustries}
        fmtDate={fmtDate}
      />

      <TenantOverridesSection industryKey={key} overrides={overrides} />
    </div>
  );
}