// src/app/pcc/llm/page.tsx
import React from "react";
import Link from "next/link";

import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";

export default async function PccLlmPage() {
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
              LLM Manager
            </h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Platform-level guardrails and prompt controls. PCC v1 is read-only; we’ll wire persistence next.
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
              Save (soon)
            </button>
          </div>
        </div>
      </div>

      {/* Guardrails */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Guardrails
          </div>
          <button
            type="button"
            disabled
            className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold opacity-50 dark:border-gray-800"
            title="Coming next"
          >
            Configure
          </button>
        </div>

        <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          Controls we’ll add next:
          <ul className="mt-2 list-disc pl-5 space-y-1">
            <li>Allowed model set (platform-approved)</li>
            <li>Max tokens / max images / timeout defaults</li>
            <li>Safety posture presets (strict / balanced / permissive)</li>
            <li>PII / PHI handling policy (redaction + storage rules)</li>
          </ul>
        </div>
      </div>

      {/* Prompts */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Prompt Library
          </div>
          <button
            type="button"
            disabled
            className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold opacity-50 dark:border-gray-800"
            title="Coming next"
          >
            Add prompt
          </button>
        </div>

        <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          We’ll store versioned prompts here and let tenants inherit defaults:
          <ul className="mt-2 list-disc pl-5 space-y-1">
            <li>Assessment prompt (per industry)</li>
            <li>Live Q&amp;A prompt</li>
            <li>Rendering prompt templates + style presets</li>
            <li>System “tone” presets</li>
          </ul>
        </div>
      </div>

      {/* Environment controls */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Environment Controls (preview)
        </div>
        <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          PCC will eventually manage environment toggles like:
          <ul className="mt-2 list-disc pl-5 space-y-1">
            <li>Feature flags per environment (dev/stage/prod)</li>
            <li>Rate limits</li>
            <li>Maintenance mode</li>
            <li>Audit logging verbosity</li>
          </ul>
        </div>
      </div>
    </div>
  );
}