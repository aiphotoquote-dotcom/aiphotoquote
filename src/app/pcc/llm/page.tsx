// src/app/pcc/llm/page.tsx
import React from "react";
import { requirePlatformRole } from "@/lib/rbac/guards";
import { getActorContext } from "@/lib/rbac/actor";
import { LlmManagerClient } from "@/components/pcc/llm/LlmManagerClient";
import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";

export const runtime = "nodejs";

export default async function PccLlmPage() {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const actor = await getActorContext();
  const cfg = await loadPlatformLlmConfig();

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">LLM Manager</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Manage platform prompt sets and safety guardrails. V1 stores config as JSON (no migrations yet).
        </p>
        <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Signed in as{" "}
          <span className="font-semibold text-gray-700 dark:text-gray-200">
            {actor.email ?? actor.clerkUserId}
          </span>
        </div>
      </div>

      <LlmManagerClient initialConfig={cfg} />
    </div>
  );
}