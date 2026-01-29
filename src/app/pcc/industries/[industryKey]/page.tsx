// src/app/pcc/industries/[industryKey]/page.tsx
import React from "react";
import Link from "next/link";
import { eq, asc, desc, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { industries, tenantSubIndustries, tenants } from "@/lib/db/schema";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ industryKey: string }>;
};

export default async function PccIndustryDetailPage({ params }: Props) {
  await requirePlatformRole([
    "platform_owner",
    "platform_admin",
    "platform_support",
    "platform_billing",
  ]);

  const { industryKey } = await params;
  const key = decodeURIComponent(industryKey || "").trim();

  const [industry] = await db
    .select({
      id: industries.id,
      key: industries.key,
      label: industries.label,
      description: industries.description,
      createdAt: industries.createdAt,
    })
    .from(industries)
    .where(eq(industries.key, key))
    .limit(1);

  if (!industry) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Industry not found
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            No industry exists with key:{" "}
            <span className="font-mono text-xs">{key || "(empty)"}</span>
          </p>

          <div className="mt-4">
            <Link
              href="/pcc/industries"
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
            >
              Back to industries
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // --- Tenant override counts by sub-industry key (from tenant_sub_industries)
  // NOTE: tenant_sub_industries is per-tenant override/extension. We show summary + sample tenants.
  const overrides = await db
    .select({
      subKey: tenantSubIndustries.key,
      subLabel: tenantSubIndustries.label,
      tenantCount: sql<number>`count(distinct ${tenantSubIndustries.tenantId})`.as("tenantCount"),
    })
    .from(tenantSubIndustries)
    .innerJoin(tenants, eq(tenants.id, tenantSubIndustries.tenantId))
    .where(eq(tenants.slug, tenants.slug)) // keep join stable; no filter yet (v1)
    .groupBy(tenantSubIndustries.key, tenantSubIndustries.label)
    .orderBy(desc(sql<number>`count(distinct ${tenantSubIndustries.tenantId})`), asc(tenantSubIndustries.label))
    .limit(50);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              PCC • Industries
            </div>
            <h1 className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100">
              {industry.label}
            </h1>
            <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">
              Key: <span className="font-mono text-xs">{industry.key}</span>
            </div>
            {industry.description ? (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                {industry.description}
              </p>
            ) : null}
          </div>

          <div className="shrink-0 flex gap-2">
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
              title="PCC v1 is read-only"
            >
              Edit industry (soon)
            </button>
          </div>
        </div>
      </div>

      {/* Default sub-industries (placeholder for v1) */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Default sub-industries
          </div>
          <button
            type="button"
            disabled
            className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold opacity-50 dark:border-gray-800"
            title="We’ll add defaults table next"
          >
            Add default (next)
          </button>
        </div>

        <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">
          PCC v1 will introduce a global defaults table (ex:{" "}
          <span className="font-mono text-xs">industry_sub_industries</span>) so
          tenants can start from a standard list and optionally override.
        </div>
      </div>

      {/* Tenant overrides */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Tenant overrides (summary)
          </div>

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
          This data comes from <span className="font-mono">tenant_sub_industries</span>.
          Next, we’ll associate overrides to an industry key.
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
                  <tr
                    key={`${r.subKey}:${r.subLabel}`}
                    className="border-b border-gray-100 last:border-b-0 dark:border-gray-900"
                  >
                    <td className="py-3 pr-3 font-semibold text-gray-900 dark:text-gray-100">
                      {r.subLabel}
                    </td>
                    <td className="py-3 pr-3 font-mono text-xs text-gray-700 dark:text-gray-200">
                      {r.subKey}
                    </td>
                    <td className="py-3 pr-0 text-right font-semibold text-gray-900 dark:text-gray-100">
                      {Number(r.tenantCount || 0)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="py-10 text-center text-sm text-gray-600 dark:text-gray-300">
                    No tenant overrides exist yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}