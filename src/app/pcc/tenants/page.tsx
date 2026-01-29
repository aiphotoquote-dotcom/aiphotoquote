// src/app/pcc/tenants/page.tsx
import React from "react";
import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";
import { tenants } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export default async function PccTenantsPage() {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

  const rows = await db.select().from(tenants).orderBy(desc(tenants.createdAt)).limit(50);

  return (
    <main className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">Tenants</div>
        <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">Latest 50 tenants (search UI next).</div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-900">
        <div className="divide-y divide-gray-200 dark:divide-gray-800">
          {rows.map((t: any) => (
            <a
              key={t.id}
              href={`/pcc/tenants/${t.id}`}
              className="block px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-950"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {t.name ?? t.slug ?? t.id}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-600 dark:text-gray-300 truncate">
                    {t.slug ? `/${t.slug}` : t.id}
                  </div>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {t.createdAt ? new Date(t.createdAt).toLocaleDateString() : ""}
                </div>
              </div>
            </a>
          ))}
          {!rows.length ? (
            <div className="px-4 py-6 text-sm text-gray-600 dark:text-gray-300">No tenants found.</div>
          ) : null}
        </div>
      </div>
    </main>
  );
}