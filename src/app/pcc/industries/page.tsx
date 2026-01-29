// src/app/pcc/industries/page.tsx
import React from "react";
import Link from "next/link";

import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";

export default async function PccIndustriesPage() {
  await requirePlatformRole([
    "platform_owner",
    "platform_admin",
    "platform_support",
    "platform_billing",
  ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs text-gray-500 dark:text-gray-400">PCC</div>
            <h1 className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100">
              Industries
            </h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Manage platform industries and sub-industries. PCC v1 is read-only; we’ll wire DB + edit flows next.
            </p>
          </div>

          <div className="shrink-0 flex gap-2">
            <Link
              href="/pcc"
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
              Add industry (soon)
            </button>
          </div>
        </div>
      </div>

      {/* Global industries */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Platform industries
          </div>

          <button
            type="button"
            disabled
            className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold opacity-50 dark:border-gray-800"
            title="Coming next"
          >
            Sync / seed
          </button>
        </div>

        <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          Next we’ll:
          <ul className="mt-2 list-disc pl-5 space-y-1">
            <li>Read from <code className="text-xs">industries</code></li>
            <li>Add “sub-industries” table (platform-level) OR treat sub-industries as tenant overrides only</li>
            <li>Expose CRUD with audit trail</li>
          </ul>
        </div>

        {/* Placeholder list */}
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
          <div className="font-semibold">Coming soon</div>
          <div className="mt-1">
            This panel will show platform industries (key, label, description) with edit controls.
          </div>
        </div>
      </div>

      {/* Tenant overrides */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Tenant sub-industry overrides
        </div>
        <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          We’ll support per-tenant overrides/extensions using{" "}
          <code className="text-xs">tenant_sub_industries</code>:
          <ul className="mt-2 list-disc pl-5 space-y-1">
            <li>Tenant adds custom sub-industries (key + label)</li>
            <li>PCC can view all tenants’ overrides for support</li>
            <li>Optional: “promote to platform” action later</li>
          </ul>
        </div>

        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
          <div className="font-semibold">Coming soon</div>
          <div className="mt-1">
            This panel will show tenant overrides with filters by tenant + industry.
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Related
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href="/pcc/llm"
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
          >
            LLM Manager
          </Link>
          <Link
            href="/pcc/env"
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
          >
            Environment Controls
          </Link>
        </div>
      </div>
    </div>
  );
}