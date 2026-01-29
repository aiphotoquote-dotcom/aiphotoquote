// src/app/pcc/layout.tsx
import React from "react";
import { requirePlatformRole } from "@/lib/rbac/guards";

export default async function PccLayout({ children }: { children: React.ReactNode }) {
  // Anyone in these roles can access PCC v1 shell.
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 space-y-6">
      <header className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="text-xs text-gray-600 dark:text-gray-300">Platform Control Center</div>
        <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">PCC</div>

        <nav className="mt-4 flex flex-wrap gap-2">
          <a className="rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-gray-800" href="/pcc">
            Dashboard
          </a>
          <a className="rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-gray-800" href="/pcc/tenants">
            Tenants
          </a>
          <a className="rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-gray-800" href="/pcc/audit">
            Audit
          </a>
        </nav>
      </header>

      {children}
    </div>
  );
}