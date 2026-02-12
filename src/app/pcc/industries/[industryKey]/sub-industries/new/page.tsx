// src/app/pcc/industries/[industryKey]/sub-industries/new/page.tsx
import React from "react";
import Link from "next/link";

import { requirePlatformRole } from "@/lib/rbac/guards";
import NewSubIndustryClient from "./NewSubIndustryClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ industryKey: string }>;
};

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function titleFromKey(key: string) {
  const s = safeTrim(key);
  if (!s) return "";
  return s
    .split(/[_\-]+/g)
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(" ");
}

export default async function NewDefaultSubIndustryPage(props: Props) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

  const p = await props.params;
  const industryKey = safeTrim(decodeURIComponent(p?.industryKey || ""));

  if (!industryKey) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Missing industry key</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Cannot add a sub-industry without an industry.</p>
          <div className="mt-4">
            <Link
              href="/pcc/industries"
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
            >
              Back to industries
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const industryLabel = titleFromKey(industryKey) || industryKey;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs text-gray-500 dark:text-gray-400">PCC • Industries</div>
            <h1 className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100">Add default sub-industry</h1>

            <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">
              Industry: <span className="font-semibold">{industryLabel}</span>{" "}
              <span className="ml-2 font-mono text-[11px] text-gray-500 dark:text-gray-400">{industryKey}</span>
            </div>

            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              This creates a <span className="font-mono text-xs">industry_sub_industries</span> row (global default). Tenants can still
              override/extend via <span className="font-mono text-xs">tenant_sub_industries</span>.
            </p>
          </div>

          <div className="shrink-0 flex gap-2">
            <Link
              href={`/pcc/industries/${encodeURIComponent(industryKey)}`}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
            >
              Cancel
            </Link>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <NewSubIndustryClient industryKey={industryKey} />
      </div>
    </div>
  );
}