// src/app/pcc/industries/[industryKey]/ConfirmedTenantsSection.tsx

import React from "react";
import Link from "next/link";

type ConfirmedTenant = {
  tenantId: string;
  name: string;
  slug: string;
  tenantStatus: string;
  createdAt: any;

  planTier: string;
  monthlyQuoteLimit: number | null;
  graceTotal: number;
  graceUsed: number;
  graceRemaining: number;

  brandLogoUrl: string | null;
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function ConfirmedTenantsSection(props: { confirmed: ConfirmedTenant[]; fmtDate: (d: any) => string }) {
  const { confirmed, fmtDate } = props;

  return (
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
              {confirmed.map((t) => (
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
  );
}