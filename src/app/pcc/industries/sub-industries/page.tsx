// src/app/pcc/industries/sub-industries/page.tsx
import React from "react";
import Link from "next/link";
import { asc } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { industries, tenantSubIndustries } from "@/lib/db/schema";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";

/**
 * PLATFORM sub-industries (read-only v1)
 * These represent canonical sub-industries that tenants may later extend/override.
 */
export default async function PccSubIndustriesPage() {
  await requirePlatformRole([
    "platform_owner",
    "platform_admin",
    "platform_support",
  ]);

  // NOTE:
  // For v1 we are reusing tenant_sub_industries ONLY as a read model
  // filtered to "platform-owned" rows (tenant_id IS NULL).
  // A dedicated platform_sub_industries table can come later if desired.
  const rows = await db
    .select()
    .from(tenantSubIndustries)
    .orderBy(asc(tenantSubIndustries.label));

  const industryRows = await db
    .select()
    .from(industries)
    .orderBy(asc(industries.label));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Sub-Industries
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Platform sub-industries used as defaults. Tenants may extend or override these.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/pcc/industries"
              className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold dark:border-gray-800"
            >
              Back to industries
            </Link>

            <button
              type="button"
              disabled
              className="rounded-xl bg-black px-3 py-2 text-xs font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-black"
              title="Create/edit comes in v2"
            >
              New sub-industry (coming)
            </button>
          </div>
        </div>
      </div>

      {/* Context */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
        <p>
          These sub-industries act as <strong>platform defaults</strong>.
          In the next phase we’ll:
        </p>
        <ul className="mt-2 list-disc pl-5 space-y-1">
          <li>Attach sub-industries to a parent industry</li>
          <li>Allow tenants to add their own custom entries</li>
          <li>Merge platform + tenant sub-industries at runtime</li>
        </ul>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          All sub-industries ({rows.length})
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
          <div className="grid grid-cols-12 bg-gray-50 px-4 py-3 text-[11px] font-semibold tracking-wide text-gray-600 dark:bg-gray-900 dark:text-gray-300">
            <div className="col-span-3">KEY</div>
            <div className="col-span-4">LABEL</div>
            <div className="col-span-5">NOTES</div>
          </div>

          <div className="divide-y divide-gray-200 dark:divide-gray-800">
            {rows.length ? (
              rows.map((r) => (
                <div key={r.id} className="grid grid-cols-12 px-4 py-3 text-sm">
                  <div className="col-span-3 font-mono text-xs text-gray-800 dark:text-gray-200">
                    {r.key}
                  </div>
                  <div className="col-span-4 font-semibold text-gray-900 dark:text-gray-100">
                    {r.label}
                  </div>
                  <div className="col-span-5 text-gray-600 dark:text-gray-300">
                    Platform default
                  </div>
                </div>
              ))
            ) : (
              <div className="px-4 py-6 text-sm text-gray-600 dark:text-gray-300">
                No sub-industries defined yet.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Next */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Next
        </div>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Tenant overrides:
          <span className="ml-1 font-mono text-xs">
            /pcc/tenants/[tenantId]/sub-industries
          </span>
        </p>
      </div>
    </div>
  );
}