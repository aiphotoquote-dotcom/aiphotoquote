// src/app/pcc/page.tsx
import "server-only";

import React from "react";
import { getActorContext } from "@/lib/rbac/actor";

export const dynamic = "force-dynamic";

export default async function PccPage() {
  const actor = await getActorContext();

  return (
    <main className="mx-auto w-full max-w-4xl p-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Platform Control Center</h1>

        <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Signed in as <span className="font-semibold">{actor.clerkUserId}</span> • Role:{" "}
          <span className="font-semibold">{actor.platformRole ?? "none"}</span>
        </div>

        <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
          PCC v1 is live. Next up: wire platform RBAC + tenant management + billing controls.
        </div>
      </div>
    </main>
  );
}