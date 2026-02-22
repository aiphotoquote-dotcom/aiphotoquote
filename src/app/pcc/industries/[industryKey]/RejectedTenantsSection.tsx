// src/app/pcc/industries/[industryKey]/RejectedTenantsSection.tsx

import React from "react";
import Link from "next/link";

type RejectedTenant = {
  tenantId: string;
  name: string;
  slug: string;
  tenantStatus: string;
  createdAt: any;
  website: string | null;
  aiStatus: string | null;
  aiSource: string | null;
  aiUpdatedAt: string | null;
};

export default function RejectedTenantsSection(props: {
  industryKey: string;
  rejectedTenants: RejectedTenant[];
  fmtDate: (d: any) => string;
}) {
  const { industryKey, rejectedTenants, fmtDate } = props;

  if (!rejectedTenants.length) return null;

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/40 dark:bg-amber-950/30">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">Rejected tenants</div>
        <div className="text-xs text-amber-800/80 dark:text-amber-100/80">
          Tenants who rejected <span className="font-mono">{industryKey}</span> (stored in{" "}
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
            {rejectedTenants.map((t) => (
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
  );
}