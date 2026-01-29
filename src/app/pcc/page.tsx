// src/app/pcc/page.tsx
import React from "react";
import Link from "next/link";

import { requirePlatformRole } from "@/lib/rbac/guards";
import { getActorContext } from "@/lib/rbac/actor";

export const runtime = "nodejs";

function Card({
  title,
  description,
  href,
  badge,
}: {
  title: string;
  description: string;
  href: string;
  badge?: string;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-gray-300 hover:shadow-sm dark:border-gray-800 dark:bg-gray-950 dark:hover:border-gray-700"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </div>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            {description}
          </p>
        </div>

        {badge ? (
          <span className="shrink-0 rounded-full border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-700 dark:border-gray-800 dark:text-gray-200">
            {badge}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

export default async function PccHomePage() {
  // PCC requires platform-level access
  await requirePlatformRole([
    "platform_owner",
    "platform_admin",
    "platform_support",
    "platform_billing",
  ]);

  const actor = await getActorContext();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Platform Control Center
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Centralized administration for AI Photo Quote.
        </p>

        <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Signed in as{" "}
          <span className="font-semibold">{actor.email ?? actor.clerkUserId}</span>
        </div>
      </div>

      {/* Core sections */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Tenants & Memberships"
          description="View tenants, manage tenant membership, ownership, and roles."
          href="/pcc/tenants"
        />

        <Card
          title="RBAC & Platform Roles"
          description="Control who can administer the platform and sensitive systems."
          href="/pcc/rbac"
          badge="critical"
        />

        <Card
          title="Industries & Sub-Industries"
          description="Manage global industries and tenant-level overrides."
          href="/pcc/industries"
        />

        <Card
          title="LLM Manager"
          description="Guardrails, prompt packs, and AI runtime controls."
          href="/pcc/llm"
          badge="v1"
        />

        <Card
          title="Environment Controls"
          description="Feature flags, model routing, emergency switches."
          href="/pcc/environment"
          badge="planned"
        />

        <Card
          title="Billing & Usage"
          description="Platform usage, quotas, and billing controls."
          href="/pcc/billing"
          badge="future"
        />
      </div>

      {/* Footer note */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
        PCC v1 is intentionally read-only.  
        Each section will gain persistence, auditing, and billing hooks incrementally.
      </div>
    </div>
  );
}