// src/app/pcc/env/page.tsx

import { getActorContext } from "@/lib/rbac/actor";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const dynamic = "force-dynamic";

function SafeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-200 py-3 last:border-b-0 dark:border-gray-800">
      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</div>
      <div className="min-w-0 text-right text-sm text-gray-700 dark:text-gray-200 break-all">{value}</div>
    </div>
  );
}

/**
 * PCC v1: Environment Controls
 * - v1 is intentionally "read-only + safe visibility" (no secrets)
 * - future: feature flags, maintenance mode, platform-level guardrails, kill-switches, etc.
 */
export default async function PccEnvPage() {
  // Access control: only platform roles can view PCC env
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);
  const actor = await getActorContext();

  // Only expose SAFE, non-secret environment information
  const safeEnv = {
    NODE_ENV: process.env.NODE_ENV ?? "unknown",
    VERCEL_ENV: process.env.VERCEL_ENV ?? "unknown",
    VERCEL_REGION: process.env.VERCEL_REGION ?? "unknown",
    VERCEL_URL: process.env.VERCEL_URL ?? "unknown",
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="text-xs text-gray-600 dark:text-gray-300">Platform Control Center</div>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">Environment</h1>
        <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">
          Signed in as <span className="font-semibold">{actor.clerkUserId}</span>
        </div>
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
          This page is intentionally <span className="font-semibold">read-only</span> in v1. It shows safe runtime
          context (no secrets). Later we’ll add platform feature flags and maintenance controls.
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Runtime context</div>
        <div className="mt-3">
          <SafeRow label="NODE_ENV" value={safeEnv.NODE_ENV} />
          <SafeRow label="VERCEL_ENV" value={safeEnv.VERCEL_ENV} />
          <SafeRow label="VERCEL_REGION" value={safeEnv.VERCEL_REGION} />
          <SafeRow label="VERCEL_URL" value={safeEnv.VERCEL_URL} />
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Planned controls (next)</div>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-gray-700 dark:text-gray-200">
          <li>Platform feature flags (PCC-managed, DB-backed)</li>
          <li>Maintenance mode + banner messaging</li>
          <li>LLM kill-switch + model routing overrides</li>
          <li>Rate limits / abuse controls</li>
          <li>Billing enforcement toggles (future)</li>
        </ul>
      </div>
    </div>
  );
}