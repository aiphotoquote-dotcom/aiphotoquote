// src/app/pcc/industries/[industryKey]/page.tsx

import React from "react";
import Link from "next/link";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";

import ConfirmIndustryButton from "./ConfirmIndustryButton";
import AddDefaultSubIndustryButton from "./AddDefaultSubIndustryButton";
import ToggleDefaultSubIndustryActiveButton from "./ToggleDefaultSubIndustryActiveButton";

import IndustryPromptPackEditor from "./IndustryPromptPackEditor";
import GenerateIndustryPackButton from "./GenerateIndustryPackButton";

import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ industryKey: string }>;
  searchParams?: Promise<{ showInactive?: string }>;
};

function rows(r: any): any[] {
  return (r as any)?.rows ?? (Array.isArray(r) ? r : []);
}

function firstRow(r: any): any | null {
  const rr = rows(r);
  return rr[0] ?? null;
}

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function fmtDate(d: any) {
  try {
    if (!d) return "";
    const dt = d instanceof Date ? d : new Date(d);
    if (!Number.isFinite(dt.getTime())) return "";
    return dt.toLocaleString();
  } catch {
    return "";
  }
}

function toBool(v: any) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v ?? "").toLowerCase().trim();
  return s === "true" || s === "t" || s === "1" || s === "yes";
}

function toNum(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function titleFromKey(key: string) {
  const s = String(key ?? "").trim();
  if (!s) return "";
  return s
    .split(/[_\-]+/g)
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(" ");
}

function safeJsonParse(v: any): any | null {
  try {
    if (!v) return null;
    if (typeof v === "object") return v;
    const s = String(v);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

function pick(obj: any, paths: string[]): any {
  for (const p of paths) {
    const parts = p.split(".");
    let cur = obj;
    let ok = true;
    for (const k of parts) {
      if (!cur || typeof cur !== "object" || !(k in cur)) {
        ok = false;
        break;
      }
      cur = cur[k];
    }
    if (ok) return cur;
  }
  return null;
}

function normalizeUrl(u: string | null) {
  const s = safeTrim(u);
  if (!s) return null;
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  return `https://${s}`;
}

function asStringArray(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").trim()).filter(Boolean);
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

  // ✅ PCC platform config (for industry prompt packs editable in UI)
  const pcc = await loadPlatformLlmConfig();
  const pack = (pcc?.prompts?.industryPromptPacks ?? {})[String(key).toLowerCase()] ?? null;

  // -----------------------------
  // Industry metadata (optional)
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
  // Confirmed tenants (tenant_settings.industry_key)
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
  // AI-suggested tenants (exclude explicit rejections)
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
  // Tenants who explicitly rejected THIS industry key
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
  // ✅ Default sub-industries (global)
  // - includes isActive + inUseCount
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
  // Tenant sub-industry overrides summary (scoped to confirmed tenants + this industry)
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

  const confirmedCount = confirmed.length;
  const aiSuggestedCount = aiSuggestedAll.length;
  const aiUnconfirmedCount = aiUnconfirmed.length;

  const needsConfirmCount = aiSuggestedAll.filter((x: any) => x.needsConfirmation).length;
  const runningCount = aiSuggestedAll.filter((x: any) => String(x.aiStatus ?? "").toLowerCase() === "running").length;
  const errorCount = aiSuggestedAll.filter((x: any) => String(x.aiStatus ?? "").toLowerCase() === "error").length;

  return (
    <div className="space-y-6">
      {/* ✅ Editable industry prompt pack (platform-owned) */}
      <IndustryPromptPackEditor industryKey={String(key).toLowerCase()} initialPack={pack as any} />

      {/* Header */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs text-gray-500 dark:text-gray-400">PCC • Industries</div>

            <h1 className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100">{industry.label}</h1>

            <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">
              Key: <span className="font-mono text-xs">{industry.key}</span>
              {!industry.isCanonical ? (
                <span className="ml-2 text-[11px] text-amber-700 dark:text-amber-200">
                  (derived — industries table has no row for this key yet)
                </span>
              ) : null}
            </div>

            {industry.description ? <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{industry.description}</p> : null}

            <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
              <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 font-semibold text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-200">
                confirmed: {confirmedCount}
              </span>
              <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-semibold text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-100">
                AI suggested: {aiSuggestedCount}
              </span>
              <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                needs confirm: {needsConfirmCount}
              </span>
              {runningCount ? (
                <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-semibold text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-100">
                  running: {runningCount}
                </span>
              ) : null}
              {errorCount ? (
                <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-semibold text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                  errors: {errorCount}
                </span>
              ) : null}
              {aiUnconfirmedCount ? (
                <span className="inline-flex items-center rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 font-semibold text-purple-900 dark:border-purple-900/40 dark:bg-purple-950/30 dark:text-purple-100">
                  AI-only (unconfirmed): {aiUnconfirmedCount}
                </span>
              ) : null}
              {rejectedTenants.length ? (
                <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                  rejected: {rejectedTenants.length}
                </span>
              ) : null}
            </div>
          </div>

          <div className="shrink-0 flex flex-col items-end gap-2">
            <div className="flex gap-2">
              <Link
                href="/pcc/industries"
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              >
                Back
              </Link>

              <button
                type="button"
                disabled
                className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold opacity-50 dark:border-gray-800"
                title="Industry metadata editing is not yet wired; prompt packs are editable above."
              >
                Edit industry (soon)
              </button>
            </div>

            {/* ✅ NEW: backfill/generate stored industry LLM pack */}
            <GenerateIndustryPackButton
              industryKey={industry.key}
              industryLabel={industry.label}
              industryDescription={industry.description}
            />
          </div>
        </div>
      </div>

      {/* Confirmed tenants */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Confirmed tenants</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            From <span className="font-mono">tenant_settings.industry_key</span>
          </div>
        </div>

        {confirmed.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  <th className="py-3 pr-3">Tenant</th>
                  <th className="py-3 pr-3">Tier</th>
                  <th className="py-3 pr-3">Monthly limit</th>
                  <th className="py-3 pr-3">Grace credits</th>
                  <th className="py-3 pr-3">Status</th>
                  <th className="py-3 pr-0 text-right">Actions</th>
                </tr>
              </thead>

              <tbody>
                {confirmed.map((t: any) => (
                  <tr key={t.tenantId} className="border-b border-gray-100 last:border-b-0 dark:border-gray-900">
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-3">
                        {t.brandLogoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={t.brandLogoUrl}
                            alt={`${t.name} logo`}
                            className="h-9 w-9 rounded-lg border border-gray-200 bg-white object-contain p-1 dark:border-gray-800 dark:bg-black"
                          />
                        ) : (
                          <div className="h-9 w-9 rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-black" />
                        )}

                        <div className="min-w-0">
                          <div className="truncate font-semibold text-gray-900 dark:text-gray-100">{t.name}</div>
                          <div className="truncate font-mono text-[11px] text-gray-600 dark:text-gray-300">{t.slug}</div>
                          <div className="truncate font-mono text-[11px] text-gray-500 dark:text-gray-400">
                            {String(t.tenantId).slice(0, 8)} · {t.createdAt ? fmtDate(t.createdAt) : ""}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3 pr-3 font-mono text-xs text-gray-700 dark:text-gray-200">{t.planTier}</td>

                    <td className="py-3 pr-3 font-mono text-xs text-gray-700 dark:text-gray-200">
                      {t.monthlyQuoteLimit === null ? "unlimited" : String(t.monthlyQuoteLimit)}
                    </td>

                    <td className="py-3 pr-3 text-xs text-gray-700 dark:text-gray-200">
                      <span className="font-mono">{t.graceTotal}</span> total · <span className="font-mono">{t.graceUsed}</span> used ·{" "}
                      <span className="font-mono">{t.graceRemaining}</span> left
                    </td>

                    <td className="py-3 pr-3">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                          String(t.tenantStatus).toLowerCase() === "archived"
                            ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
                            : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
                        )}
                      >
                        {String(t.tenantStatus).toUpperCase()}
                      </span>
                    </td>

                    <td className="py-3 pr-0 text-right">
                      <Link href={`/pcc/tenants/${encodeURIComponent(t.tenantId)}`} className="text-xs font-semibold underline">
                        View tenant →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-300">
            No confirmed tenants for this industry yet.
          </div>
        )}
      </div>

      {/* AI suggested tenants */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">AI suggested tenants</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            From <span className="font-mono">tenant_onboarding.ai_analysis.suggestedIndustryKey</span>
          </div>
        </div>

        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          We split this into <span className="font-semibold">AI-only</span> (not yet confirmed) and{" "}
          <span className="font-semibold">also confirmed</span> (useful to measure AI accuracy).
          {rejectedTenants.length ? <span className="ml-1">Rejected tenants are excluded from this list and shown below.</span> : null}
        </div>

        {/* AI-only */}
        <div className="mt-4">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">AI-only (unconfirmed)</div>

          {aiUnconfirmed.length ? (
            <div className="mt-2 grid gap-2">
              {aiUnconfirmed.map((t: any) => (
                <div key={t.tenantId} className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{t.name}</div>
                      <div className="font-mono text-[11px] text-gray-600 dark:text-gray-300 truncate">{t.slug}</div>

                      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                        <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-semibold text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-100">
                          fit: {t.fit ?? "—"}
                        </span>

                        <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2 py-0.5 font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
                          confidence: {Math.round((t.confidenceScore ?? 0) * 100)}%
                        </span>

                        {t.needsConfirmation ? (
                          <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                            needs confirmation
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-3 space-y-2">
                        {t.suggestedLabel ? (
                          <div className="text-sm text-gray-800 dark:text-gray-200">
                            <span className="font-semibold">AI label:</span> {t.suggestedLabel}
                          </div>
                        ) : null}

                        {t.businessGuess ? (
                          <div className="text-sm text-gray-700 dark:text-gray-200">
                            <span className="font-semibold">Business guess:</span> {t.businessGuess}
                          </div>
                        ) : null}

                        {t.website ? (
                          <div className="text-[11px] text-gray-600 dark:text-gray-300">
                            <span className="font-semibold">Website:</span>{" "}
                            <a href={t.website} className="underline" target="_blank" rel="noreferrer">
                              {t.website}
                            </a>
                          </div>
                        ) : null}

                        {t.aiReason ? (
                          <div className="text-[11px] text-gray-600 dark:text-gray-300">
                            <span className="font-semibold">Reason:</span> {t.aiReason}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="shrink-0 text-right space-y-2">
                      <Link href={`/pcc/tenants/${encodeURIComponent(t.tenantId)}`} className="text-xs font-semibold underline">
                        View →
                      </Link>

                      <div className="text-[11px] text-gray-500 dark:text-gray-400">{t.createdAt ? fmtDate(t.createdAt) : ""}</div>

                      <ConfirmIndustryButton tenantId={t.tenantId} tenantName={t.name} industryKey={key} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-300">
              No AI-only suggestions for this industry.
            </div>
          )}
        </div>

        {/* Also confirmed */}
        <div className="mt-6">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">AI suggested (also confirmed)</div>

          {aiAlsoConfirmed.length ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                    <th className="py-3 pr-3">Tenant</th>
                    <th className="py-3 pr-3">Fit</th>
                    <th className="py-3 pr-3">Confidence</th>
                    <th className="py-3 pr-3">Needs confirm</th>
                    <th className="py-3 pr-0 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {aiAlsoConfirmed.map((t: any) => (
                    <tr key={t.tenantId} className="border-b border-gray-100 last:border-b-0 dark:border-gray-900">
                      <td className="py-3 pr-3">
                        <div className="font-semibold text-gray-900 dark:text-gray-100">{t.name}</div>
                        <div className="font-mono text-[11px] text-gray-600 dark:text-gray-300">{t.slug}</div>
                      </td>
                      <td className="py-3 pr-3 font-mono text-xs text-gray-700 dark:text-gray-200">{t.fit ?? "—"}</td>
                      <td className="py-3 pr-3 font-mono text-xs text-gray-700 dark:text-gray-200">
                        {Math.round((t.confidenceScore ?? 0) * 100)}%
                      </td>
                      <td className="py-3 pr-3 text-xs text-gray-700 dark:text-gray-200">{t.needsConfirmation ? "yes" : "no"}</td>
                      <td className="py-3 pr-0 text-right">
                        <Link href={`/pcc/tenants/${encodeURIComponent(t.tenantId)}`} className="text-xs font-semibold underline">
                          View →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">None.</div>
          )}
        </div>
      </div>

      {/* Rejected tenants */}
      {rejectedTenants.length ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/40 dark:bg-amber-950/30">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">Rejected tenants</div>
            <div className="text-xs text-amber-800/80 dark:text-amber-100/80">
              Tenants who rejected <span className="font-mono">{key}</span> (stored in{" "}
              <span className="font-mono">ai_analysis.rejectedIndustryKeys</span>)
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-amber-200/60 text-xs text-amber-900/80 dark:border-amber-900/40 dark:text-amber-100/80">
                  <th className="py-3 pr-3">Tenant</th>
                  <th className="py-3 pr-3">Website</th>
                  <th className="py-3 pr-3">Meta</th>
                  <th className="py-3 pr-0 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rejectedTenants.map((t: any) => (
                  <tr key={t.tenantId} className="border-b border-amber-200/40 last:border-b-0 dark:border-amber-900/30">
                    <td className="py-3 pr-3">
                      <div className="font-semibold text-amber-950 dark:text-amber-100">{t.name}</div>
                      <div className="font-mono text-[11px] text-amber-900/70 dark:text-amber-100/70">{t.slug}</div>
                      <div className="mt-1 text-[11px] text-amber-900/70 dark:text-amber-100/70">
                        {String(t.tenantId).slice(0, 8)} · {t.createdAt ? fmtDate(t.createdAt) : ""}
                      </div>
                    </td>

                    <td className="py-3 pr-3 text-[11px] text-amber-900/80 dark:text-amber-100/80">
                      {t.website ? (
                        <a href={t.website} className="underline" target="_blank" rel="noreferrer">
                          {t.website}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>

                    <td className="py-3 pr-3 text-[11px] text-amber-900/80 dark:text-amber-100/80">
                      {t.aiStatus ? <div>status: {t.aiStatus}</div> : <div>status: —</div>}
                      {t.aiSource ? (
                        <div>
                          source: <span className="font-mono">{t.aiSource}</span>
                        </div>
                      ) : (
                        <div>source: —</div>
                      )}
                      {t.aiUpdatedAt ? <div>updated: {t.aiUpdatedAt}</div> : null}
                    </td>

                    <td className="py-3 pr-0 text-right">
                      <Link href={`/pcc/tenants/${encodeURIComponent(t.tenantId)}`} className="text-xs font-semibold underline">
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* ✅ Default sub-industries (global) */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Default sub-industries</div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              From <span className="font-mono">industry_sub_industries</span> where{" "}
              <span className="font-mono">industry_key</span> = <span className="font-mono">{key}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={`/pcc/industries/${encodeURIComponent(key)}?showInactive=${showInactive ? "0" : "1"}`}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              title="Toggle inactive rows visibility"
            >
              {showInactive ? "Hide inactive" : `Show inactive (${inactiveCount})`}
            </Link>

            <AddDefaultSubIndustryButton industryKey={key} />
          </div>
        </div>

        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Tenants can still override/extend via <span className="font-mono">tenant_sub_industries</span>. “In use” counts only
          confirmed tenants for this industry.
        </p>

        {defaultSubIndustries.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  <th className="py-3 pr-3">Sub-industry</th>
                  <th className="py-3 pr-3">Key</th>
                  <th className="py-3 pr-3">Sort</th>
                  <th className="py-3 pr-3">In use</th>
                  <th className="py-3 pr-3">Status</th>
                  <th className="py-3 pr-0 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {defaultSubIndustries.map((s) => (
                  <tr
                    key={s.id}
                    className={cn("border-b border-gray-100 last:border-b-0 dark:border-gray-900", !s.isActive && "opacity-60")}
                  >
                    <td className="py-3 pr-3">
                      <div className="font-semibold text-gray-900 dark:text-gray-100">{s.subLabel}</div>
                      {s.description ? <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{s.description}</div> : null}
                    </td>
                    <td className="py-3 pr-3 font-mono text-xs text-gray-700 dark:text-gray-200">{s.subKey}</td>
                    <td className="py-3 pr-3 font-mono text-xs text-gray-700 dark:text-gray-200">{s.sortOrder}</td>
                    <td className="py-3 pr-3">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                          s.inUseCount > 0
                            ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
                            : "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-200"
                        )}
                        title={
                          s.inUseCount > 0
                            ? "Confirmed tenants using this subKey (via tenant_sub_industries)"
                            : "No confirmed tenants using this subKey yet"
                        }
                      >
                        {s.inUseCount}
                      </span>
                    </td>
                    <td className="py-3 pr-3">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                          s.isActive
                            ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
                            : "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-200"
                        )}
                      >
                        {s.isActive ? "ACTIVE" : "INACTIVE"}
                      </span>
                    </td>
                    <td className="py-3 pr-0 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">
                          {s.updatedAt ? (
                            <span title={`Created: ${s.createdAt ? fmtDate(s.createdAt) : "—"}`}>updated {fmtDate(s.updatedAt)}</span>
                          ) : (
                            "—"
                          )}
                        </div>

                        <ToggleDefaultSubIndustryActiveButton
                          industryKey={key}
                          subKey={s.subKey}
                          subLabel={s.subLabel}
                          isActive={s.isActive}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-300">
            No default sub-industries for this industry yet. Use <span className="font-semibold">Add default</span> to create the first
            one.
          </div>
        )}
      </div>

      {/* Tenant overrides (summary) */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Tenant overrides (summary)</div>
          <button
            type="button"
            disabled
            className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold opacity-50 dark:border-gray-800"
            title="PCC v1 is read-only"
          >
            Review tenants (soon)
          </button>
        </div>

        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Scoped to tenants where <span className="font-mono">tenant_settings.industry_key</span> ={" "}
          <span className="font-mono">{key}</span> and <span className="font-mono">tenant_sub_industries.industry_key</span> ={" "}
          <span className="font-mono">{key}</span>.
        </p>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="py-3 pr-3">Sub-industry label</th>
                <th className="py-3 pr-3">Key</th>
                <th className="py-3 pr-0 text-right">Tenants using</th>
              </tr>
            </thead>

            <tbody>
              {overrides.length ? (
                overrides.map((r: any) => (
                  <tr key={`${r.subKey}:${r.subLabel}`} className="border-b border-gray-100 last:border-b-0 dark:border-gray-900">
                    <td className="py-3 pr-3 font-semibold text-gray-900 dark:text-gray-100">{r.subLabel}</td>
                    <td className="py-3 pr-3 font-mono text-xs text-gray-700 dark:text-gray-200">{r.subKey}</td>
                    <td className="py-3 pr-0 text-right font-semibold text-gray-900 dark:text-gray-100">
                      {Number(r.tenantCount || 0)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="py-10 text-center text-sm text-gray-600 dark:text-gray-300">
                    No tenant overrides exist for confirmed tenants in this industry.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}