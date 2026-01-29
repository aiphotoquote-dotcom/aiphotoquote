// src/app/pcc/page.tsx
import { getActorContext } from "@/lib/rbac/actor";
import { requirePlatformRole } from "@/lib/rbac/guards";
import { getPlatformConfig } from "@/lib/platform/getPlatformConfig";

export const runtime = "nodejs";

export default async function PccHomePage() {
  // PCC access gate (v1: owner/admin/support/billing can view)
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

  const actor = await getActorContext();
  const cfg = await getPlatformConfig();

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="text-sm text-gray-600 dark:text-gray-300">{label}</div>
      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  );

  const pill = (txt: string) => (
    <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
      {txt}
    </span>
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Platform Control Center</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Control platform-wide settings, tenant governance, LLM guardrails, and (soon) billing.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {pill(`Actor: ${actor.clerkUserId.slice(0, 8)}`)}
              {pill(`Role: ${actor.platformRole ?? "none"}`)}
              {pill(`Env: ${process.env.VERCEL_ENV ?? "unknown"}`)}
            </div>
          </div>

          <div className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
            Updated: {cfg.updatedAt ? new Date(cfg.updatedAt).toLocaleString() : "—"}
          </div>
        </div>
      </div>

      {/* Platform flags */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Platform flags</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Read-only in v1. Next we’ll add toggles via server actions.
            </p>
          </div>
        </div>

        <div className="mt-4 divide-y divide-gray-100 dark:divide-gray-800">
          {row("AI quoting", cfg.aiQuotingEnabled ? "Enabled" : "Disabled")}
          {row("AI rendering", cfg.aiRenderingEnabled ? "Enabled" : "Disabled")}
          {row("Maintenance mode", cfg.maintenanceEnabled ? "ON" : "Off")}
          {cfg.maintenanceEnabled
            ? row("Maintenance message", cfg.maintenanceMessage ? cfg.maintenanceMessage : "—")
            : null}
        </div>
      </section>

      {/* Roadmap tiles (v1 placeholders) */}
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Industry / Sub-industry manager</div>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Curate industries, sub-industries, defaults, and tenant eligibility.
          </p>
          <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">Coming next</div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">LLM manager</div>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Guardrails, prompts, tool policies, and safety / compliance controls.
          </p>
          <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">Coming next</div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Environment controls</div>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Feature flags, freeze switches, rollout modes, and global throttles.
          </p>
          <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">Coming next</div>
        </div>
      </section>
    </main>
  );
}