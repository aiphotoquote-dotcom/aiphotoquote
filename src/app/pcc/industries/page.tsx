// src/app/pcc/industries/page.tsx
import React from "react";
import Link from "next/link";

import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IndustryRow = {
  key: string;
  label: string;
  description: string | null;
  createdAt: string | Date;

  confirmedCount: number;
  aiSuggestedCount: number;
  aiNeedsConfirmCount: number;

  aiRunningCount: number;
  aiErrorCount: number;
  aiCompleteCount: number;

  aiFitGoodCount: number;
  aiFitMaybeCount: number;
  aiFitPoorCount: number;
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

async function loadIndustries(): Promise<IndustryRow[]> {
  const res = await fetch(`/api/pcc/industries`, { cache: "no-store" }).catch(() => null);
  if (!res) return [];
  const j = (await res.json().catch(() => null)) as any;
  if (!j?.ok || !Array.isArray(j.industries)) return [];
  return j.industries as IndustryRow[];
}

export default async function PccIndustriesPage() {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const industries = await loadIndustries();

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Industries</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Canonical industry list + onboarding AI signals (suggested industry + confirmation state).
            </p>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {industries.length} {industries.length === 1 ? "industry" : "industries"}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
        <div className="grid grid-cols-12 gap-0 border-b border-gray-200 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
          <div className="col-span-4">Industry</div>
          <div className="col-span-3">Key</div>
          <div className="col-span-3">Onboarding state</div>
          <div className="col-span-2 text-right">Confirmed</div>
        </div>

        {industries.length ? (
          <div className="divide-y divide-gray-200 dark:divide-gray-800">
            {industries.map((i) => {
              const anyIssues = (i.aiErrorCount ?? 0) > 0;
              const anyRunning = (i.aiRunningCount ?? 0) > 0;
              const needsConfirm = (i.aiNeedsConfirmCount ?? 0) > 0;

              return (
                <div key={i.key} className="grid grid-cols-12 gap-0 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900">
                  <div className="col-span-4 min-w-0">
                    <div className="truncate font-semibold text-gray-900 dark:text-gray-100">{i.label}</div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
                      {i.description || "—"}
                    </div>
                  </div>

                  <div className="col-span-3 min-w-0">
                    <div className="truncate font-mono text-xs text-gray-700 dark:text-gray-200">{i.key}</div>
                    <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                      AI suggested: <span className="font-mono">{i.aiSuggestedCount ?? 0}</span>
                    </div>
                  </div>

                  <div className="col-span-3 min-w-0">
                    <div className="flex flex-wrap gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                          needsConfirm
                            ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
                            : "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-200"
                        )}
                      >
                        needs confirm: {i.aiNeedsConfirmCount ?? 0}
                      </span>

                      {anyRunning ? (
                        <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-100">
                          running: {i.aiRunningCount ?? 0}
                        </span>
                      ) : null}

                      {anyIssues ? (
                        <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                          errors: {i.aiErrorCount ?? 0}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                      fit:{" "}
                      <span className="font-mono">
                        good {i.aiFitGoodCount ?? 0} · maybe {i.aiFitMaybeCount ?? 0} · poor {i.aiFitPoorCount ?? 0}
                      </span>
                    </div>

                    <div className="mt-2">
                      <Link
                        href={`/pcc/industries/${encodeURIComponent(i.key)}`}
                        className="text-xs font-semibold underline text-gray-700 dark:text-gray-200"
                      >
                        View tenants →
                      </Link>
                    </div>
                  </div>

                  <div className="col-span-2 flex items-center justify-end">
                    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-mono text-gray-900 dark:border-gray-800 dark:bg-black dark:text-gray-100">
                      {i.confirmedCount ?? 0}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-4 py-8 text-sm text-gray-600 dark:text-gray-300">
            No industries found. (If this is unexpected, verify your industries seed ran.)
          </div>
        )}
      </div>
    </div>
  );
}