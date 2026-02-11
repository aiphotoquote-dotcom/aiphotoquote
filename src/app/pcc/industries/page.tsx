// src/app/pcc/industries/page.tsx
import React from "react";
import Link from "next/link";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";
import IndustriesSearchBar from "./IndustriesSearchBar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rows(r: any): any[] {
  return (r as any)?.rows ?? (Array.isArray(r) ? r : []);
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

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

type SortKey = "label" | "confirmed" | "needsConfirm" | "aiSuggested";
type FilterKey = "all" | "needsConfirm" | "aiOnly" | "confirmedOnly";

function buildHref(
  base: string,
  next: Record<string, string | undefined | null>,
  current: Record<string, string | undefined>
) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (!v) continue;
    p.set(k, v);
  }
  for (const [k, v] of Object.entries(next)) {
    if (v === null || v === undefined || String(v).trim() === "") p.delete(k);
    else p.set(k, String(v));
  }
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}

function pill(active: boolean) {
  return active
    ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-black"
    : "border-gray-200 bg-white text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-950";
}

export default async function PccIndustriesPage(props: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

  const sp = props.searchParams ?? {};
  const rawSort = Array.isArray(sp.sort) ? sp.sort[0] : sp.sort;
  const rawFilter = Array.isArray(sp.filter) ? sp.filter[0] : sp.filter;
  const rawQ = Array.isArray(sp.q) ? sp.q[0] : sp.q;

  const sort: SortKey =
    rawSort === "confirmed" || rawSort === "needsConfirm" || rawSort === "aiSuggested" || rawSort === "label"
      ? rawSort
      : "label";

  const filter: FilterKey =
    rawFilter === "needsConfirm" || rawFilter === "aiOnly" || rawFilter === "confirmedOnly" || rawFilter === "all"
      ? rawFilter
      : "all";

  const q = safeTrim(rawQ).toLowerCase();

  const currentParams = {
    sort,
    filter,
    q: q || undefined,
  };

  // Canonical industries
  const canonicalR = await db.execute(sql`
    select
      key::text as "key",
      label::text as "label",
      description::text as "description"
    from industries
    order by label asc
    limit 500
  `);

  const canonical = rows(canonicalR).map((r: any) => ({
    key: String(r.key ?? ""),
    label: String(r.label ?? ""),
    description: r.description ? String(r.description) : null,
  }));

  // Counts by confirmed industry
  const confirmedCountsR = await db.execute(sql`
    select
      ts.industry_key::text as "key",
      count(*)::int as "confirmedCount"
    from tenant_settings ts
    group by ts.industry_key
  `);

  const confirmedCounts = new Map<string, number>();
  for (const r of rows(confirmedCountsR)) {
    confirmedCounts.set(String(r.key), Number(r.confirmedCount || 0));
  }

  // Counts by AI suggested industry + needsConfirmation
  const aiCountsR = await db.execute(sql`
    select
      (ob.ai_analysis->>'suggestedIndustryKey')::text as "key",
      count(*)::int as "aiSuggestedCount",
      sum(
        case
          when (ob.ai_analysis->>'needsConfirmation')::text = 'true' then 1
          when (ob.ai_analysis->>'needsConfirmation')::text = 't' then 1
          else 0
        end
      )::int as "needsConfirmCount"
    from tenant_onboarding ob
    where (ob.ai_analysis->>'suggestedIndustryKey') is not null
      and (ob.ai_analysis->>'suggestedIndustryKey') <> ''
    group by (ob.ai_analysis->>'suggestedIndustryKey')
  `);

  const aiSuggestedCounts = new Map<string, number>();
  const needsConfirmCounts = new Map<string, number>();
  for (const r of rows(aiCountsR)) {
    const k = String(r.key ?? "");
    aiSuggestedCounts.set(k, Number(r.aiSuggestedCount || 0));
    needsConfirmCounts.set(k, Number(r.needsConfirmCount || 0));
  }

  // Fallback list if industries table is empty
  let list: Array<{ key: string; label: string; description: string | null }> = canonical;

  if (!list.length) {
    const discoveredKeys = new Set<string>();
    for (const k of confirmedCounts.keys()) discoveredKeys.add(k);
    for (const k of aiSuggestedCounts.keys()) discoveredKeys.add(k);

    list = Array.from(discoveredKeys)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map((k) => ({ key: k, label: titleFromKey(k) || k, description: null }));
  }

  // Augment rows for sorting/filter/search
  const augmented = list.map((it) => {
    const confirmed = confirmedCounts.get(it.key) ?? 0;
    const aiSuggested = aiSuggestedCounts.get(it.key) ?? 0;
    const needsConfirm = needsConfirmCounts.get(it.key) ?? 0;

    const label = it.label || titleFromKey(it.key) || it.key;
    const hay = `${label} ${it.key}`.toLowerCase();

    return {
      ...it,
      label,
      confirmed,
      aiSuggested,
      needsConfirm,
      _hay: hay,
      _isAiOnly: aiSuggested > 0 && confirmed === 0,
    };
  });

  // Search
  let filtered = q ? augmented.filter((x) => x._hay.includes(q)) : augmented;

  // Filter
  if (filter === "needsConfirm") filtered = filtered.filter((x) => x.aiSuggested > 0 && x.needsConfirm > 0);
  if (filter === "aiOnly") filtered = filtered.filter((x) => x._isAiOnly);
  if (filter === "confirmedOnly") filtered = filtered.filter((x) => x.confirmed > 0);

  // Sort
  filtered.sort((a, b) => {
    if (sort === "label") return a.label.localeCompare(b.label);
    if (sort === "confirmed") return b.confirmed - a.confirmed || a.label.localeCompare(b.label);
    if (sort === "needsConfirm") return b.needsConfirm - a.needsConfirm || a.label.localeCompare(b.label);
    if (sort === "aiSuggested") return b.aiSuggested - a.aiSuggested || a.label.localeCompare(b.label);
    return a.label.localeCompare(b.label);
  });

  const totalIndustries = filtered.length;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Industries</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Canonical industry list + onboarding AI signals (suggested industry + confirmation state).
              {!canonical.length ? (
                <>
                  {" "}
                  <span className="font-semibold">
                    (Fallback: derived from tenant settings + onboarding because industries table is empty.)
                  </span>
                </>
              ) : null}
            </p>

            {/* Controls */}
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <div className="lg:col-span-1">
                <IndustriesSearchBar />
              </div>

              <div className="lg:col-span-1">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Filter</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link
                    href={buildHref("/pcc/industries", { filter: "all" }, currentParams)}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold ${pill(filter === "all")}`}
                  >
                    All
                  </Link>
                  <Link
                    href={buildHref("/pcc/industries", { filter: "needsConfirm" }, currentParams)}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold ${pill(filter === "needsConfirm")}`}
                  >
                    Needs confirm
                  </Link>
                  <Link
                    href={buildHref("/pcc/industries", { filter: "aiOnly" }, currentParams)}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold ${pill(filter === "aiOnly")}`}
                  >
                    AI-only
                  </Link>
                  <Link
                    href={buildHref("/pcc/industries", { filter: "confirmedOnly" }, currentParams)}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold ${pill(filter === "confirmedOnly")}`}
                  >
                    Confirmed only
                  </Link>
                </div>
              </div>

              <div className="lg:col-span-1">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Sort</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link
                    href={buildHref("/pcc/industries", { sort: "label" }, currentParams)}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold ${pill(sort === "label")}`}
                  >
                    Label
                  </Link>
                  <Link
                    href={buildHref("/pcc/industries", { sort: "confirmed" }, currentParams)}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold ${pill(sort === "confirmed")}`}
                  >
                    Confirmed
                  </Link>
                  <Link
                    href={buildHref("/pcc/industries", { sort: "needsConfirm" }, currentParams)}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold ${pill(sort === "needsConfirm")}`}
                  >
                    Needs confirm
                  </Link>
                  <Link
                    href={buildHref("/pcc/industries", { sort: "aiSuggested" }, currentParams)}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold ${pill(sort === "aiSuggested")}`}
                  >
                    AI suggested
                  </Link>
                </div>
              </div>
            </div>
          </div>

          <div className="shrink-0 text-sm text-gray-500 dark:text-gray-400">{totalIndustries} industries</div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-0 overflow-hidden dark:border-gray-800 dark:bg-gray-950">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500 dark:border-gray-800 dark:bg-black dark:text-gray-400">
                <th className="py-3 px-4">Industry</th>
                <th className="py-3 px-4">Key</th>
                <th className="py-3 px-4">Onboarding state</th>
                <th className="py-3 px-4 text-right">Confirmed</th>
              </tr>
            </thead>

            <tbody>
              {filtered.length ? (
                filtered.map((it) => {
                  return (
                    <tr key={it.key} className="border-b border-gray-100 last:border-b-0 dark:border-gray-900">
                      <td className="py-3 px-4">
                        <Link
                          href={`/pcc/industries/${encodeURIComponent(it.key)}`}
                          className="font-semibold text-gray-900 underline dark:text-gray-100"
                        >
                          {it.label}
                        </Link>
                        {it.description ? (
                          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{it.description}</div>
                        ) : null}
                      </td>

                      <td className="py-3 px-4 font-mono text-xs text-gray-700 dark:text-gray-200">{it.key}</td>

                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-2 text-[11px]">
                          <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-semibold text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-100">
                            AI suggested: {it.aiSuggested}
                          </span>

                          {it.aiSuggested === 0 ? (
                            <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 font-semibold text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-200">
                              no AI data
                            </span>
                          ) : it.needsConfirm > 0 ? (
                            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                              needs confirm: {it.needsConfirm}
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
                              clean
                            </span>
                          )}

                          {it._isAiOnly ? (
                            <span className="inline-flex items-center rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 font-semibold text-purple-900 dark:border-purple-900/40 dark:bg-purple-950/30 dark:text-purple-100">
                              AI-only
                            </span>
                          ) : null}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-right font-semibold text-gray-900 dark:text-gray-100">{it.confirmed}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-sm text-gray-600 dark:text-gray-300">
                    No industries match this view. Try clearing filters/search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!canonical.length ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          Heads up: your <span className="font-mono">industries</span> table is empty, so PCC is showing a derived list.
          This is fine for now; later we’ll seed canonical labels/descriptions.
        </div>
      ) : null}
    </div>
  );
}