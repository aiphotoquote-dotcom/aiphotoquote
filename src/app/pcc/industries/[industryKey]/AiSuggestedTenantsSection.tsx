// src/app/pcc/industries/[industryKey]/AiSuggestedTenantsSection.tsx

import React from "react";
import Link from "next/link";
import ConfirmIndustryButton from "./ConfirmIndustryButton";

type AiTenant = {
  tenantId: string;
  name: string;
  slug: string;
  tenantStatus: string;
  createdAt: any;

  website: string | null;
  businessGuess: string | null;
  suggestedLabel: string | null;

  fit: string | null;
  confidenceScore: number;
  needsConfirmation: boolean;

  aiStatus: string | null;
  aiSource: string | null;
  aiPrevSuggested: string | null;

  aiRound: number | null;
  aiUpdatedAt: string | null;
  aiModel: string | null;
  aiReason: string | null;

  rejectedIndustryKeys: string[];
  topCandidates: Array<{ label: string; key: string; score: number }>;
};

export default function AiSuggestedTenantsSection(props: {
  industryKey: string;
  aiUnconfirmed: AiTenant[];
  aiAlsoConfirmed: AiTenant[];
  rejectedCount: number;
  fmtDate: (d: any) => string;
}) {
  const { industryKey, aiUnconfirmed, aiAlsoConfirmed, rejectedCount, fmtDate } = props;

  return (
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
        {rejectedCount ? <span className="ml-1">Rejected tenants are excluded from this list and shown below.</span> : null}
      </div>

      {/* AI-only */}
      <div className="mt-4">
        <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">AI-only (unconfirmed)</div>

        {aiUnconfirmed.length ? (
          <div className="mt-2 grid gap-2">
            {aiUnconfirmed.map((t) => (
              <div key={t.tenantId} className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{t.name}</div>
                    <div className="font-mono text-[11px] text-gray-600 dark:text-gray-300 truncate">{t.slug}</div>

                    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
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
                    </div>

                    <div className="mt-3 space-y-2">
                      {t.suggestedLabel ? (
                        <div className="text-sm text-gray-800 dark:text-gray-200">
                          <span className="font-semibold">AI label:</span> {t.suggestedLabel}
                        </div>
                      ) : null}

                      {t.businessGuess ? (
                        <div className="text-sm text-gray-700 dark:text-gray-200">
                          <span className="font-semibold">Business guess:</span> {t.businessGuess}
                        </div>
                      ) : null}

                      {t.website ? (
                        <div className="text-[11px] text-gray-600 dark:text-gray-300">
                          <span className="font-semibold">Website:</span>{" "}
                          <a href={t.website} className="underline" target="_blank" rel="noreferrer">
                            {t.website}
                          </a>
                        </div>
                      ) : null}

                      {t.aiReason ? (
                        <div className="text-[11px] text-gray-600 dark:text-gray-300">
                          <span className="font-semibold">Reason:</span> {t.aiReason}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="shrink-0 text-right space-y-2">
                    <Link href={`/pcc/tenants/${encodeURIComponent(t.tenantId)}`} className="text-xs font-semibold underline">
                      View →
                    </Link>

                    <div className="text-[11px] text-gray-500 dark:text-gray-400">{t.createdAt ? fmtDate(t.createdAt) : ""}</div>

                    <ConfirmIndustryButton tenantId={t.tenantId} tenantName={t.name} industryKey={industryKey} />
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
                {aiAlsoConfirmed.map((t) => (
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
  );
}