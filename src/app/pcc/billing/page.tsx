// src/app/pcc/billing/page.tsx
import React from "react";

export const runtime = "nodejs";

function Card({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3 dark:border-gray-800 dark:bg-gray-950">
      <div>
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</div>
        {desc ? (
          <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">{desc}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="min-w-0">
        <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">{label}</div>
        {hint ? (
          <div className="mt-0.5 text-[11px] text-gray-600 dark:text-gray-300">{hint}</div>
        ) : null}
      </div>
      <div className="shrink-0 text-xs font-semibold text-gray-700 dark:text-gray-200">
        {value}
      </div>
    </div>
  );
}

export default function PccBillingPage() {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Billing & Usage
        </div>
        <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Platform-level billing visibility and controls. PCC v1 is read-only by design.
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Platform Usage"
          desc="High-level visibility across all tenants."
        >
          <Row
            label="Quote submissions"
            value="Coming soon"
            hint="Aggregate count across all tenants."
          />
          <Row
            label="AI render jobs"
            value="Coming soon"
            hint="Used for cost tracking + abuse detection."
          />
        </Card>

        <Card
          title="Cost Controls"
          desc="Global safety rails before tenant-level billing."
        >
          <Row
            label="Monthly AI spend cap"
            value="Coming soon"
            hint="Hard stop to protect platform exposure."
          />
          <Row
            label="Overage behavior"
            value="Coming soon"
            hint="Block, degrade, or queue when limits hit."
          />
        </Card>

        <Card
          title="Tenant Billing Model"
          desc="How tenants will eventually be charged."
        >
          <Row
            label="Billing mode"
            value="Not enabled"
            hint="Per-quote, per-render, or subscription."
          />
          <Row
            label="Invoice generation"
            value="Not enabled"
            hint="Stripe / manual export planned."
          />
        </Card>

        <Card
          title="Audit & Compliance"
          desc="Billing-related actions are always audited."
        >
          <Row
            label="Audit logging"
            value="Planned"
            hint="Every billing mutation will be logged."
          />
          <Row
            label="Read-only (v1)"
            value="Yes"
            hint="No financial mutations yet."
          />
        </Card>
      </div>

      <Card
        title="Next steps (billing roadmap)"
        desc="We do this after RBAC + tenant isolation is rock solid."
      >
        <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700 dark:text-gray-200">
          <li>Define tenant billing plans + entitlements.</li>
          <li>Add usage metering tables (append-only).</li>
          <li>Integrate Stripe (or Gov-friendly alt) behind feature flags.</li>
          <li>Expose tenant-facing billing view (read-only first).</li>
        </ul>
      </Card>
    </div>
  );
}