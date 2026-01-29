// src/app/pcc/industries/page.tsx
import React from "react";
import Link from "next/link";
import { desc, asc } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { industries } from "@/lib/db/schema";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";

export default async function PccIndustriesPage() {
  await requirePlatformRole([
    "platform_owner",
    "platform_admin",
    "platform_support",
    "platform_billing",
  ]);

  const rows = await db
    .select({
      id: industries.id,
      key: industries.key,
      label: industries.label,
      description: industries.description,
      createdAt: industries.createdAt,
    })
    .from(industries)
    .orderBy(asc(industries.label), asc(industries.key));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Industries
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Global industry catalog used for tenant configuration and downstream reporting.
            </p>
          </div>

          <Link
            href="/pcc"
            className="shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
          >
            Back to PCC
          </Link>
        </div>
      </div>

      {/* List */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            All industries
          </div>

          {/* v1: read-only, keep button but disabled */}
          <button
            type="button"
            disabled
            className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold opacity-50 dark:border-gray-800"
            title="PCC v1 is read-only"
          >
            Add industry (soon)
          </button>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="py-3 pr-3">Label</th>
                <th className="py-3 pr-3">Key</th>
                <th className="py-3 pr-3">Description</th>
                <th className="py-3 pr-0 text-right">Actions</th>
              </tr>
            </thead>

            <tbody>
              {rows.length ? (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-gray-100 last:border-b-0 dark:border-gray-900"
                  >
                    <td className="py-3 pr-3 font-semibold text-gray-900 dark:text-gray-100">
                      {r.label}
                    </td>
                    <td className="py-3 pr-3 font-mono text-xs text-gray-700 dark:text-gray-200">
                      {r.key}
                    </td>
                    <td className="py-3 pr-3 text-gray-600 dark:text-gray-300">
                      {r.description ? r.description : <span className="italic text-gray-400">—</span>}
                    </td>
                    <td className="py-3 pr-0 text-right">
                      <Link
                        href={`/pcc/industries/${encodeURIComponent(r.key)}`}
                        className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:text-gray-100"
                      >
                        Manage sub-industries
                      </Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={4}
                    className="py-10 text-center text-sm text-gray-600 dark:text-gray-300"
                  >
                    No industries found in <code className="font-mono">industries</code>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
          Next: industry detail page will manage default sub-industries and tenant overrides.
        </div>
      </div>
    </div>
  );
}