// src/app/pcc/llm/page.tsx
import React from "react";
import Link from "next/link";

import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";

type ChipTone = "gray" | "green" | "yellow" | "red" | "blue";

function chip(label: string, tone: ChipTone = "gray") {
  const toneCls =
    tone === "green"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900/40"
      : tone === "yellow"
        ? "bg-yellow-50 text-yellow-800 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-200 dark:border-yellow-900/40"
        : tone === "red"
          ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900/40"
          : tone === "blue"
            ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900/40"
            : "bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-900 dark:text-gray-200 dark:border-gray-800";

  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold",
        toneCls,
      ].join(" ")}
    >
      {label}
    </span>
  );
}

function cardTitle(title: string, subtitle?: string) {
  return (
    <div>
      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</div>
      {subtitle ? <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">{subtitle}</div> : null}
    </div>
  );
}

export default async function PccLlmPage() {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  // v1 = UI shell + placeholders (no schema changes yet)
  // v2 will persist these settings + prompt packs + per-tenant overrides.

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">LLM Manager</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Platform-level controls for guardrails, prompting, and runtime environment.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {chip("PCC v1 (read-only)", "blue")}
              {chip("RBAC protected", "green")}
              {chip("Persistence in v2", "yellow")}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/pcc"
              className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold dark:border-gray-800"
            >
              Back to PCC
            </Link>
          </div>
        </div>
      </div>

      {/* Guardrails */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-4">
          {cardTitle(
            "Guardrails",
            "Policy knobs that apply across the platform. Tenant settings can override within allowed bounds."
          )}

          <button
            type="button"
            disabled
            className="shrink-0 rounded-xl bg-black px-3 py-2 text-xs font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-black"
            title="Editable in v2"
          >
            Edit (coming)
          </button>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Safety mode</div>
              {chip("standard", "green")}
            </div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Default moderation posture. (v2: tenant caps + audit log)
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">PII handling</div>
              {chip("minimize", "yellow")}
            </div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Reduce or redact personal data in prompts/logs where possible.
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Logging</div>
              {chip("enabled", "blue")}
            </div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Keeps prompt/response metadata for debugging + compliance. (v2: retention controls)
            </div>
          </div>
        </div>
      </div>

      {/* Prompt manager */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        {cardTitle("Prompt Manager", "Reusable prompt packs for quote assessment, Q&A, and rendering.")}

        <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
          <div className="grid grid-cols-12 bg-gray-50 px-4 py-3 text-[11px] font-semibold tracking-wide text-gray-600 dark:bg-gray-900 dark:text-gray-300">
            <div className="col-span-3">PACK</div>
            <div className="col-span-3">PURPOSE</div>
            <div className="col-span-3">VERSION</div>
            <div className="col-span-3">STATUS</div>
          </div>

          <div className="divide-y divide-gray-200 dark:divide-gray-800">
            {[
              { pack: "quote_assessment", purpose: "Estimate output", version: "v1", status: "active" },
              { pack: "live_qa", purpose: "Follow-up questions", version: "v1", status: "active" },
              { pack: "render_prompt", purpose: "AI rendering", version: "v1", status: "draft" },
            ].map((r) => (
              <div key={r.pack} className="grid grid-cols-12 px-4 py-3 text-sm">
                <div className="col-span-3 font-mono text-xs text-gray-800 dark:text-gray-200">{r.pack}</div>
                <div className="col-span-3 text-gray-700 dark:text-gray-200">{r.purpose}</div>
                <div className="col-span-3 text-gray-700 dark:text-gray-200">{r.version}</div>
                <div className="col-span-3">
                  {r.status === "active" ? chip("active", "green") : chip("draft", "yellow")}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
          v2 will add:
          <ul className="mt-2 list-disc pl-5 space-y-1">
            <li>DB-backed prompt packs + versioning</li>
            <li>Diff view + “promote to active” workflow</li>
            <li>Per-tenant overrides with platform caps</li>
          </ul>
        </div>
      </div>

      {/* Environment controls */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        {cardTitle("Environment Controls", "Model routing + feature flags, managed centrally.")}

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Default model</div>
              {chip("platform default", "blue")}
            </div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              v2: store model per workload (assessment vs QA vs render).
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Kill switch</div>
              {chip("off", "green")}
            </div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Emergency disable for AI actions platform-wide.
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Rate limits</div>
              {chip("defaults", "yellow")}
            </div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              v2: quotas by tenant, and billing hooks later.
            </div>
          </div>
        </div>
      </div>

      {/* Next */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Next (recommended)</div>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Add the **PCC navigation hub** so you can bounce between Industries / LLM / Env / Tenants without guessing URLs.
        </p>
        <div className="mt-3">
          <span className="font-mono text-xs text-gray-700 dark:text-gray-200">src/app/pcc/page.tsx</span>
        </div>
      </div>
    </div>
  );
}