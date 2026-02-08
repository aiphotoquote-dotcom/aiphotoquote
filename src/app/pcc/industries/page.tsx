// src/app/pcc/industries/page.tsx
import React from "react";
import Link from "next/link";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rows(r: any): any[] {
  return (r as any)?.rows ?? (Array.isArray(r) ? r : []);
}

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function titleFromKey(key: string) {
  // landscaping_hardscaping -> Landscaping Hardscaping
  const s = String(key ?? "").trim();
  if (!s) return "";
  return s
    .split(/[_\-]+/g)
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(" ");
}

function toBool(v: any) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v ?? "").toLowerCase().trim();
  return s === "true" || s === "t" || s === "1" || s === "yes";
}

export default async function PccIndustriesPage() {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

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
      (to.ai_analysis->>'suggestedIndustryKey')::text as "key",
      count(*)::int as "aiSuggestedCount",
      sum(
        case
          when (to.ai_analysis->>'needsConfirmation')::text = 'true' then 1
          when (to.ai_analysis->>'needsConfirmation')::text = 't' then 1
          else 0
        end
      )::int as "needsConfirmCount"
    from tenant_onboarding to
    where (to.ai_analysis->>'suggestedIndustryKey') is not null
      and (to.ai_analysis->>'suggestedIndustryKey') <> ''
    group by (to.ai_analysis->>'suggestedIndustryKey')
  `);

  const aiSuggestedCounts = new Map<string, number>();
  const needsConfirmCounts = new Map<string, number>();
  for (const r of rows(aiCountsR)) {
    const k = String(r.key ?? "");
    aiSuggestedCounts.set(k, Number(r.aiSuggestedCount || 0));
    needsConfirmCounts.set(k, Number(r.needsConfirmCount || 0));
  }

  // If canonical is empty, build a discovered list from tenant_settings + tenant_onboarding
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

  const totalIndustries = list.length;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-4">
          <div>
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
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400">{totalIndustries} industries</div>
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
              {list.length ? (
                list.map((it) => {
                  const confirmed = confirmedCounts.get(it.key) ?? 0;
                  const aiSuggested = aiSuggestedCounts.get(it.key) ?? 0;
                  const needsConfirm = needsConfirmCounts.get(it.key) ?? 0;

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
                            AI suggested: {aiSuggested}
                          </span>
                          {needsConfirm ? (
                            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                              needs confirm: {needsConfirm}
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
                              clean
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-right font-semibold text-gray-900 dark:text-gray-100">{confirmed}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-sm text-gray-600 dark:text-gray-300">
                    No industries found. (If this is unexpected, verify your industries seed ran.)
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