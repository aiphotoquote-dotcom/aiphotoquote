// src/app/pcc/page.tsx
import React from "react";
import { getActorContext } from "@/lib/rbac/actor";

export default async function PccHome() {
  const actor = await getActorContext();

  return (
    <main className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Welcome</div>
        <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Signed in as <span className="font-semibold">{actor.clerkUserId}</span> • Role:{" "}
          <span className="font-semibold">{actor.platformRole ?? "none"}</span>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <a
          href="/pcc/tenants"
          className="rounded-2xl border border-gray-200 bg-white p-5 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-950"
        >
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Tenants</div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">Search, inspect, manage plans (v1).</div>
        </a>

        <a
          href="/pcc/audit"
          className="rounded-2xl border border-gray-200 bg-white p-5 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-950"
        >
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Audit</div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">Platform-wide activity feed.</div>
        </a>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Billing (coming)</div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            PCC already has tenant plan tables so Stripe can drop in later.
          </div>
        </div>
      </div>
    </main>
  );
}