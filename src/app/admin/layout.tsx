// src/app/admin/layout.tsx
import React from "react";

import AdminTenantGateShell from "@/components/tenant/AdminTenantGateShell";
import { getPlatformConfig } from "@/lib/platform/getPlatformConfig";
import { getActorContext } from "@/lib/rbac/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function canBypassMaintenance() {
  try {
    const actor = await getActorContext();
    return (
      actor.platformRole === "platform_owner" ||
      actor.platformRole === "platform_admin" ||
      actor.platformRole === "platform_support"
    );
  } catch {
    return false;
  }
}

function AdminMaintenanceScreen({ message }: { message: string | null }) {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12 dark:bg-neutral-950">
      <div className="mx-auto max-w-2xl rounded-3xl border border-yellow-200 bg-white p-8 shadow-sm dark:border-yellow-900/40 dark:bg-neutral-900">
        <div className="inline-flex items-center rounded-full border border-yellow-200 bg-yellow-50 px-3 py-1 text-xs font-semibold text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-950/40 dark:text-yellow-100">
          Admin temporarily unavailable
        </div>

        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">
          We’re performing maintenance.
        </h1>

        <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
          {message || "The admin area is temporarily unavailable while we perform platform updates. Please check back shortly."}
        </p>

        <div className="mt-6">
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-xl bg-gray-900 px-5 py-3 text-sm font-extrabold text-white hover:opacity-90 dark:bg-white dark:text-black"
          >
            Return to home
          </a>
        </div>
      </div>
    </div>
  );
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const cfg = await getPlatformConfig();

  if (cfg.maintenanceEnabled) {
    const bypass = await canBypassMaintenance();
    if (!bypass) {
      return <AdminMaintenanceScreen message={cfg.maintenanceMessage} />;
    }
  }

  return <AdminTenantGateShell>{children}</AdminTenantGateShell>;
}