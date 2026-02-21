// src/app/pcc/industries/[industryKey]/TenantOverridesSection.tsx

import React from "react";

type OverrideRow = {
  subKey: string;
  subLabel: string;
  tenantCount: number;
};

export default function TenantOverridesSection(props: { industryKey: string; overrides: OverrideRow[] }) {
  const { industryKey, overrides } = props;

  return (
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
        <span className="font-mono">{industryKey}</span> and <span className="font-mono">tenant_sub_industries.industry_key</span> ={" "}
        <span className="font-mono">{industryKey}</span>.
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
              overrides.map((r) => (
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
  );
}