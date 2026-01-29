// src/app/pcc/industries/page.tsx
import React from "react";
import Link from "next/link";
import { asc } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { industries } from "@/lib/db/schema";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";

export default async function PccIndustriesPage() {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const rows = await db.select().from(industries).orderBy(asc(industries.label));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Industries</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Platform-wide industries (read-only v1). Sub-industries next.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/pcc"
              className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold dark:border-gray-800"
            >
              Back to PCC
            </Link>

            {/* Stub for v2 create */}
            <button
              type="button"
              className="rounded-xl bg-black px-3 py-2 text-xs font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-black"
              disabled
              title="Create is coming next"
            >
              New industry (coming)
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            All industries ({rows.length})
          </div>

          {/* Stub for sub-industries module */}
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Sub-industries manager: next file
          </span>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
          <div className="grid grid-cols-12 bg-gray-50 px-4 py-3 text-[11px] font-semibold tracking-wide text-gray-600 dark:bg-gray-900 dark:text-gray-300">
            <div className="col-span-3">KEY</div>
            <div className="col-span-4">LABEL</div>
            <div className="col-span-5">DESCRIPTION</div>
          </div>

          <div className="divide-y divide-gray-200 dark:divide-gray-800">
            {rows.length ? (
              rows.map((r) => (
                <div key={r.id} className="grid grid-cols-12 px-4 py-3 text-sm">
                  <div className="col-span-3 font-mono text-xs text-gray-800 dark:text-gray-200">{r.key}</div>
                  <div className="col-span-4 font-semibold text-gray-900 dark:text-gray-100">{r.label}</div>
                  <div className="col-span-5 text-gray-700 dark:text-gray-200">
                    {r.description ? r.description : <span className="text-gray-400">—</span>}
                  </div>
                </div>
              ))
            ) : (
              <div className="px-4 py-6 text-sm text-gray-600 dark:text-gray-300">
                No industries found.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Next */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Next</div>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Add <span className="font-mono text-xs">/pcc/industries/sub-industries</span> for platform-managed sub-industries,
          then we’ll wire tenant overrides (your <span className="font-mono text-xs">tenant_sub_industries</span> table).
        </p>
      </div>
    </div>
  );
}