// src/app/pcc/industries/[industryKey]/page.tsx
import React from "react";
import Link from "next/link";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";
import ConfirmIndustryButton from "./ConfirmIndustryButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  // Be defensive: some code paths previously treated params like a Promise.
  // Types don’t affect runtime, but this keeps the implementation robust.
  params: { industryKey?: string } | Promise<{ industryKey?: string }>;
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

function titleFromKey(key: string) {
  const s = String(key ?? "").trim();
  if (!s) return "";
  return s
    .split(/[_\-]+/g)
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(" ");
}

async function resolveParams(p: Props["params"]): Promise<{ industryKey?: string }> {
  // Support both object and Promise forms
  const anyP: any = p as any;
  if (anyP && typeof anyP.then === "function") {
    return (await anyP) as any;
  }
  return (p as any) ?? {};
}

export default async function PccIndustryDetailPage({ params }: Props) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

  const p = await resolveParams(params);
  const industryKeyRaw = p?.industryKey;

  const key = decodeURIComponent(String(industryKeyRaw ?? "")).trim();

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

          {/* Optional tiny diagnostic (safe): shows what params looked like */}
          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-200">
            <div className="font-semibold">Debug</div>
            <div className="mt-1 font-mono break-all">params.industryKey: {String(industryKeyRaw ?? "(undefined)")}</div>
          </div>
        </div>
      </div>
    );
  }

  // -----------------------------
  // Industry metadata (optional)
  // If industries table is empty, we still render the page using key-derived label.
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
  // AI-suggested tenants (tenant_onboarding.ai_analysis.suggestedIndustryKey)
  // -----------------------------
  const aiR = await db.execute(sql`
    select
      t.id::text as "tenantId",
      t.name::text as "name",
      t.slug::text as "slug",
      t.status::text as "tenantStatus",
      t.created_at as "createdAt",

      (to.ai_analysis->>'businessGuess')::text as "businessGuess",
      (to.ai_analysis->>'fit')::text as "fit",
      (to.ai_analysis->>'confidenceScore')::text as "confidenceScore",
      (to.ai_analysis->>'needsConfirmation')::text as "needsConfirmation",
      (to.ai_analysis->'meta'->>'status')::text as "aiStatus",
      (to.ai_analysis->'meta'->>'round')::text as "aiRound"
    from tenant_onboarding to
    join tenants t on t.id = to.tenant_id
    where (to.ai_analysis->>'suggestedIndustryKey') = ${key}
    order by t.created_at desc
    limit 500
  `);

  const aiSuggestedAll = rows(aiR).map((r: any) => ({
    tenantId: String(r.tenantId),
    name: String(r.name ?? ""),
    slug: String(r.slug ?? ""),
    tenantStatus: String(r.tenantStatus ?? "active"),
    createdAt: r.createdAt ?? null,

    businessGuess: r.businessGuess ? String(r.businessGuess) : null,
    fit: r.fit ? String(r.fit) : null,
    confidenceScore: toNum(r.confidenceScore, 0),
    needsConfirmation: toBool(r.needsConfirmation),
    aiStatus: r.aiStatus ? String(r.aiStatus) : null,
    aiRound: r.aiRound ? toNum(r.aiRound, 0) : null,
  }));

  const aiUnconfirmed = aiSuggestedAll.filter((t: any) => !confirmedIds.has(t.tenantId));
  const aiAlsoConfirmed = aiSuggestedAll.filter((t: any) => confirmedIds.has(t.tenantId));

  // -----------------------------
  // Tenant sub-industry overrides summary (scoped to confirmed tenants)
  // -----------------------------
  const overridesR = await db.execute(sql`
    select
      tsi.key::text as "subKey",
      tsi.label::text as "subLabel",
      count(distinct tsi.tenant_id)::int as "tenantCount"
    from tenant_sub_industries tsi
    join tenant_settings ts on ts.tenant_id = tsi.tenant_id
    where ts.industry_key = ${key}
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
            </div>
          </div>

          <div className="shrink-0 flex gap-2">
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
              title="PCC v1 is read-only"
            >
              Edit industry (soon)
            </button>
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
                      <span className="font-mono">{t.graceTotal}</span> total ·{" "}
                      <span className="font-mono">{t.graceUsed}</span> used ·{" "}
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
        </div>

        {/* AI-only */}
        <div className="mt-4">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">AI-only (unconfirmed)</div>

          {aiUnconfirmed.length ? (
            <div className="mt-2 grid gap-2">
              {aiUnconfirmed.map((t: any) => (
                <div key={t.tenantId} className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{t.name}</div>
                      <div className="font-mono text-[11px] text-gray-600 dark:text-gray-300 truncate">{t.slug}</div>

                      <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
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
                        {t.aiStatus ? (
                          <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 font-semibold text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-200">
                            status: {t.aiStatus}
                          </span>
                        ) : null}
                      </div>

                      {t.businessGuess ? <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">{t.businessGuess}</div> : null}
                    </div>

                    <div className="shrink-0 text-right space-y-2">
                      <Link href={`/pcc/tenants/${encodeURIComponent(t.tenantId)}`} className="text-xs font-semibold underline">
                        View →
                      </Link>

                      <div className="text-[11px] text-gray-500 dark:text-gray-400">{t.createdAt ? fmtDate(t.createdAt) : ""}</div>

                      <ConfirmIndustryButton tenantId={t.tenantId} industryKey={key} onDone={() => window.location.reload()} />
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

      {/* Default sub-industries placeholder */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Default sub-industries</div>
          <button
            type="button"
            disabled
            className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold opacity-50 dark:border-gray-800"
            title="We’ll add defaults table next"
          >
            Add default (next)
          </button>
        </div>

        <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">
          Next step: add a global defaults table (ex: <span className="font-mono text-xs">industry_sub_industries</span>) so tenants
          start from a standard list and can override/extend.
        </div>
      </div>

      {/* Tenant overrides (scoped to confirmed tenants) */}
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
          <span className="font-mono">{key}</span> (because <span className="font-mono">tenant_sub_industries</span> has no industry
          column yet).
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