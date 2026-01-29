// src/app/admin/pcc/llm/page.tsx
import { requirePlatformRole } from "@/lib/rbac/guards";
import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";
import { getPlatformLlm } from "@/lib/pcc/llm/apply";
import { LlmManagerClient } from "@/components/pcc/llm/LlmManagerClient";

export const runtime = "nodejs";

export default async function AdminPccLlmPage() {
  // Hard gate — only platform roles can see this control-plane UI
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  // Raw stored config (what UI edits)
  const stored = await loadPlatformLlmConfig();

  // Effective resolved config (what the platform actually uses after defaults/normalization)
  const effective = await getPlatformLlm();

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">LLM Manager</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Platform-level models, prompts, and guardrails (PCC). Changes apply globally.
        </p>
      </div>

      <LlmManagerClient
        initialConfig={stored as any}
        effective={{
          models: effective.models,
          prompts: effective.prompts,
          guardrails: effective.guardrails,
        }}
      />
    </div>
  );
}