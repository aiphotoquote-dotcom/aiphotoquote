// src/app/pcc/audit/page.tsx
import React from "react";
import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";
import { auditEvents } from "@/lib/db/pccSchema";
import { desc } from "drizzle-orm";

export default async function PccAuditPage() {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const rows = await db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(50);

  return (
    <main className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">Audit</div>
        <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">Latest 50 events.</div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-900">
        <div className="divide-y divide-gray-200 dark:divide-gray-800">
          {rows.map((e) => (
            <div key={e.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{e.action}</div>
                  <div className="mt-1 text-xs text-gray-600 dark:text-gray-300 truncate">
                    actor: {e.actorClerkUserId}
                    {e.tenantId ? ` • tenant: ${e.tenantId}` : ""}
                  </div>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {e.createdAt ? new Date(e.createdAt as any).toLocaleString() : ""}
                </div>
              </div>

              {e.meta ? (
                <pre className="mt-2 overflow-auto rounded-xl border border-gray-200 bg-black p-3 text-[11px] text-white dark:border-gray-800">
                  {JSON.stringify(e.meta, null, 2)}
                </pre>
              ) : null}
            </div>
          ))}
          {!rows.length ? (
            <div className="px-4 py-6 text-sm text-gray-600 dark:text-gray-300">No audit events yet.</div>
          ) : null}
        </div>
      </div>
    </main>
  );
}