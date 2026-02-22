// src/app/pcc/industries/[industryKey]/DefaultSubIndustriesSection.tsx

import React from "react";
import Link from "next/link";
import AddDefaultSubIndustryButton from "./AddDefaultSubIndustryButton";
import ToggleDefaultSubIndustryActiveButton from "./ToggleDefaultSubIndustryActiveButton";

type SubIndustry = {
  id: string;
  industryKey: string;
  subKey: string;
  subLabel: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: any;
  updatedAt: any;
  inUseCount: number;
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function DefaultSubIndustriesSection(props: {
  industryKey: string;
  showInactive: boolean;
  inactiveCount: number;
  defaultSubIndustries: SubIndustry[];
  fmtDate: (d: any) => string;
}) {
  const { industryKey, showInactive, inactiveCount, defaultSubIndustries, fmtDate } = props;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Default sub-industries</div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            From <span className="font-mono">industry_sub_industries</span> where{" "}
            <span className="font-mono">industry_key</span> = <span className="font-mono">{industryKey}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/pcc/industries/${encodeURIComponent(industryKey)}?showInactive=${showInactive ? "0" : "1"}`}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
            title="Toggle inactive rows visibility"
          >
            {showInactive ? "Hide inactive" : `Show inactive (${inactiveCount})`}
          </Link>

          <AddDefaultSubIndustryButton industryKey={industryKey} />
        </div>
      </div>

      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        Tenants can still override/extend via <span className="font-mono">tenant_sub_industries</span>. “In use” counts only confirmed
        tenants for this industry.
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
                <tr key={s.id} className={cn("border-b border-gray-100 last:border-b-0 dark:border-gray-900", !s.isActive && "opacity-60")}>
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
                        industryKey={industryKey}
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
          No default sub-industries for this industry yet. Use <span className="font-semibold">Add default</span> to create the first one.
        </div>
      )}
    </div>
  );
}