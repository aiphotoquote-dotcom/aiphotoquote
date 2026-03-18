// src/app/pcc/invites/page.tsx
import React from "react";
import { requirePlatformRole } from "@/lib/rbac/guards";
import { getPlatformConfig } from "@/lib/platform/getPlatformConfig";
import { getOnboardingInvites } from "@/lib/platform/getOnboardingInvites";
import InvitesClient from "./InvitesClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PccInvitesPage() {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const [config, invites] = await Promise.all([
    getPlatformConfig(),
    getOnboardingInvites(),
  ]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Onboarding Invites
            </div>
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Create and manage invite-only onboarding access for new tenants.
            </div>
          </div>

          <div className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
            onboarding_mode: {config.onboardingMode}
          </div>
        </div>
      </div>

      <InvitesClient
        initialOnboardingMode={config.onboardingMode}
        initialInvites={invites}
      />
    </div>
  );
}