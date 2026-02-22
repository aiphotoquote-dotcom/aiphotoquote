// src/app/pcc/industries/[industryKey]/IndustryHeaderCard.tsx

import React from "react";
import Link from "next/link";

import GenerateIndustryPackButton from "./GenerateIndustryPackButton";
import MergeIndustryButton from "./MergeIndustryButton";
import DeleteIndustryButton from "./DeleteIndustryButton";
import CanonicalizeIndustryButton from "./CanonicalizeIndustryButton";

type Props = {
  industry: {
    key: string;
    label: string;
    description: string | null;
    isCanonical: boolean;
  };
  industryKeyLower: string;
  dbLatest: { version: number; updatedAt: any } | null;
  counts: {
    confirmedCount: number;
    aiSuggestedCount: number;
    needsConfirmCount: number;
    runningCount: number;
    errorCount: number;
    aiUnconfirmedCount: number;
    rejectedCount: number;
  };
  fmtDate: (d: any) => string;
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function IndustryHeaderCard(props: Props) {
  const { industry, counts, dbLatest, fmtDate } = props;

  return (
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
              confirmed: {counts.confirmedCount}
            </span>

            <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-semibold text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-100">
              AI suggested: {counts.aiSuggestedCount}
            </span>

            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
              needs confirm: {counts.needsConfirmCount}
            </span>

            {counts.runningCount ? (
              <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-semibold text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-100">
                running: {counts.runningCount}
              </span>
            ) : null}

            {counts.errorCount ? (
              <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-semibold text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                errors: {counts.errorCount}
              </span>
            ) : null}

            {counts.aiUnconfirmedCount ? (
              <span className="inline-flex items-center rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 font-semibold text-purple-900 dark:border-purple-900/40 dark:bg-purple-950/30 dark:text-purple-100">
                AI-only (unconfirmed): {counts.aiUnconfirmedCount}
              </span>
            ) : null}

            {counts.rejectedCount ? (
              <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                rejected: {counts.rejectedCount}
              </span>
            ) : null}

            {dbLatest ? (
              <span
                className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
                title={dbLatest.updatedAt ? `Latest DB pack updated: ${fmtDate(dbLatest.updatedAt)}` : "Latest DB pack"}
              >
                db pack: v{dbLatest.version}
              </span>
            ) : (
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2 py-0.5 font-semibold",
                  "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-200"
                )}
              >
                db pack: none
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 flex flex-col items-end gap-3">
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
              title="Industry metadata editing is not yet wired; prompt packs are editable below."
            >
              Edit industry (soon)
            </button>
          </div>

          <div className="flex flex-col items-end gap-2">
            <GenerateIndustryPackButton
              industryKey={props.industryKeyLower}
              industryLabel={industry.label}
              industryDescription={industry.description}
            />

            <div className="flex flex-wrap justify-end gap-2">
              {!industry.isCanonical ? (
                <>
                  <CanonicalizeIndustryButton industryKey={props.industryKeyLower} defaultLabel={industry.label} />
                  <DeleteIndustryButton industryKey={props.industryKeyLower} />
                </>
              ) : (
                <>
                  <MergeIndustryButton sourceKey={props.industryKeyLower} />
                  <DeleteIndustryButton industryKey={props.industryKeyLower} />
                </>
              )}
            </div>

            <div className="text-[11px] text-gray-500 dark:text-gray-400 text-right max-w-[360px]">
              {!industry.isCanonical ? (
                <>
                  <span className="font-semibold">Make canonical</span> creates an <span className="font-mono">industries</span> row for this
                  key. <span className="font-semibold">Delete</span> purges DB artifacts for this key and is blocked if any tenants are
                  assigned.
                </>
              ) : (
                <>
                  <span className="font-semibold">Merge</span> moves tenants, sub-industries, and packs into the target, then hard-deletes
                  the source. <span className="font-semibold">Delete</span> is blocked if any tenants are still assigned.
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}