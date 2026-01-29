// src/app/pcc/env/page.tsx
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
        {desc ? <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">{desc}</div> : null}
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
        {hint ? <div className="mt-0.5 text-[11px] text-gray-600 dark:text-gray-300">{hint}</div> : null}
      </div>
      <div className="shrink-0 text-xs font-semibold text-gray-700 dark:text-gray-200">{value}</div>
    </div>
  );
}

export default function PccEnvPage() {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">Environment</div>
        <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Platform-wide controls (safe defaults + guardrails). This is PCC v1 scaffolding — read-only for now.
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Runtime"
          desc="Helpful visibility into what the platform is currently running with."
        >
          <Row label="Next.js runtime" value="nodejs" hint="PCC routes run server-side." />
          <Row label="Mode" value="Read-only (v1)" hint="We’ll add write controls after RBAC + audit logging." />
        </Card>

        <Card
          title="Feature Flags"
          desc="Global toggles that affect the platform (not tenant-specific)."
        >
          <Row label="Maintenance mode" value="Coming soon" hint="Show banner + disable quote submission." />
          <Row label="PCC write access" value="Coming soon" hint="RBAC-backed enablement for platform admins." />
        </Card>

        <Card
          title="LLM Defaults"
          desc="Global defaults used when tenants do not override."
        >
          <Row label="Default model" value="Coming soon" hint="Central place to set default model + fallbacks." />
          <Row label="Guardrails baseline" value="Coming soon" hint="Shared safety + formatting rules for all tenants." />
        </Card>

        <Card
          title="Rate Limits"
          desc="Platform throttles to protect cost and stability."
        >
          <Row label="Quote submit" value="Coming soon" hint="Per-IP and per-tenant request shaping." />
          <Row label="AI rendering" value="Coming soon" hint="Global ceiling + per-tenant caps." />
        </Card>
      </div>

      <Card
        title="Next steps (we’ll implement next)"
        desc="Small, safe, incremental build — no schema-risk changes."
      >
        <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700 dark:text-gray-200">
          <li>Add RBAC gating on PCC sections (platform roles) + a clean forbidden screen.</li>
          <li>Add audit logging for any future mutations (who/what/when).</li>
          <li>Promote Environment controls from read-only to editable (feature flags, rate limits, defaults).</li>
        </ul>
      </Card>
    </div>
  );
}
