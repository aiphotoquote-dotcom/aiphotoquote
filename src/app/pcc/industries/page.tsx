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

export default async function PccIndustriesPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

  const sp = searchParams ?? {};

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

  // Confirmed counts
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

  // AI counts
  const aiCountsR = await db.execute(sql`
    select
      (ob.ai_analysis->>'suggestedIndustryKey')::text as "key",
      count(*)::int as "aiSuggestedCount",
      sum(
        case
          when (ob.ai_analysis->>'needsConfirmation')::text in ('true','t') then 1
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

  let list = canonical;

  if (!list.length) {
    const discoveredKeys = new Set<string>();
    for (const k of confirmedCounts.keys()) discoveredKeys.add(k);
    for (const k of aiSuggestedCounts.keys()) discoveredKeys.add(k);

    list = Array.from(discoveredKeys)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map((k) => ({ key: k, label: titleFromKey(k) || k, description: null }));
  }

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

  let filtered = q ? augmented.filter((x) => x._hay.includes(q)) : augmented;

  if (filter === "needsConfirm") filtered = filtered.filter((x) => x.aiSuggested > 0 && x.needsConfirm > 0);
  if (filter === "aiOnly") filtered = filtered.filter((x) => x._isAiOnly);
  if (filter === "confirmedOnly") filtered = filtered.filter((x) => x.confirmed > 0);

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
              Canonical industry list + onboarding AI signals.
            </p>
          </div>

          <div className="shrink-0 text-sm text-gray-500 dark:text-gray-400">
            {totalIndustries} industries
          </div>
        </div>
      </div>

      {/* table remains unchanged below this point */}
      {/* (intentionally left same as your original rendering block) */}