// src/app/pcc/layout.tsx
import React from "react";
import Link from "next/link";

import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";

function NavItem({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
    >
      {label}
    </Link>
  );
}

export default async function PccLayout({ children }: { children: React.ReactNode }) {
  // ✅ Centralized PCC gate (uses existing env-driven platform roles)
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-wrap items-center gap-2">
          <NavItem href="/pcc" label="Overview" />
          <NavItem href="/pcc/industries" label="Industries" />
          <NavItem href="/pcc/llm" label="LLM Manager" />
          <NavItem href="/pcc/env" label="Environment" />
          <NavItem href="/pcc/tenants" label="Tenants" />
          <NavItem href="/pcc/billing" label="Billing" />
        </div>
        <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">Platform Control Center</div>
      </div>

      {children}
    </div>
  );
}