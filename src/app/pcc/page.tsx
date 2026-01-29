// src/app/pcc/page.tsx
import React from "react";

function PccCard({
  title,
  description,
  status = "active",
}: {
  title: string;
  description: string;
  status?: "active" | "coming";
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            {description}
          </p>
        </div>

        <div className="shrink-0">
          {status === "coming" ? (
            <span className="rounded-full border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-500 dark:border-gray-700 dark:text-gray-400">
              Soon
            </span>
          ) : (
            <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300">
              Active
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PccHomePage() {
  return (
    <div className="space-y-6">
      {/* Overview */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Platform overview
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          This control center governs the entire AI Photo Quote platform —
          cross-tenant settings, AI behavior, and future billing.
        </p>
      </div>

      {/* Primary controls */}
      <div className="grid gap-4 md:grid-cols-2">
        <PccCard
          title="Tenant & Access Control"
          description="Manage tenants, users, roles, and platform-level permissions (RBAC)."
        />

        <PccCard
          title="Industries & Sub-Industries"
          description="Define global industries, tenant overrides, and category behavior."
        />

        <PccCard
          title="LLM & AI Guardrails"
          description="Control prompting, tone, safety rules, and model-level constraints."
        />

        <PccCard
          title="Environment & Billing"
          description="Environment flags, usage limits, and billing controls."
          status="coming"
        />
      </div>

      {/* Footer note */}
      <div className="text-xs text-gray-500 dark:text-gray-400">
        PCC v1 focuses on structure and governance. Feature depth will expand
        incrementally.
      </div>
    </div>
  );
}