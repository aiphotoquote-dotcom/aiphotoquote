// src/app/pcc/tenants/page.tsx
import React from "react";
import Link from "next/link";
import { desc } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";

function fmtDate(d: any) {
  try {
    const dt = d instanceof Date ? d : new Date(d);
    if (!Number.isFinite(dt.getTime())) return "";
    return dt.toLocaleString();
  } catch {
    return "";
  }
}

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default async function PccTenantsPage() {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      ownerUserId: tenants.ownerUserId,
      ownerClerkUserId: tenants.ownerClerkUserId,
      createdAt: tenants.createdAt,
    })
    .from(tenants)
    .orderBy(desc(tenants.createdAt))
    .limit(200);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Tenants</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              PCC tenant list. Use <span className="font-semibold">Archive</span> to safely disable a tenant while
              preserving history (no data is deleted).
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Archived tenants may be hidden from normal user flows depending on filtering.
            </p>
          </div>

          <div className="text-xs text-gray-500 dark:text-gray-400">
            Showing {rows.length} {rows.length === 1 ? "tenant" : "tenants"}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
        <div className="grid grid-cols-12 gap-0 border-b border-gray-200 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
          <div className="col-span-4">Tenant</div>
          <div className="col-span-3">Slug</div>
          <div className="col-span-3">Owner</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        {rows.length ? (
          <div className="divide-y divide-gray-200 dark:divide-gray-800">
            {rows.map((t) => {
              const owner = t.ownerUserId
                ? `user:${String(t.ownerUserId).slice(0, 8)}`
                : t.ownerClerkUserId
                ? `clerk:${String(t.ownerClerkUserId).slice(0, 8)}`
                : "—";

              return (
                <div key={t.id} className="grid grid-cols-12 gap-0 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900">
                  <div className="col-span-4 min-w-0">
                    <div className="truncate font-semibold text-gray-900 dark:text-gray-100">{t.name}</div>
                    <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                      {String(t.id).slice(0, 8)} · {fmtDate(t.createdAt)}
                    </div>
                  </div>

                  <div className="col-span-3 min-w-0 truncate text-sm text-gray-700 dark:text-gray-200">{t.slug}</div>

                  <div className="col-span-3 min-w-0 truncate text-sm text-gray-700 dark:text-gray-200">{owner}</div>

                  <div className="col-span-2 flex justify-end gap-2">
                    <Link
                      href={`/pcc/tenants/${t.id}`}
                      className={cn(
                        "inline-flex items-center rounded-lg border px-3 py-2 text-xs font-semibold",
                        "border-gray-200 bg-white text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-950"
                      )}
                    >
                      View
                    </Link>

                    {/* Keep route path the same to avoid breaking anything; UI label is now Archive */}
                    <Link
                      href={`/pcc/tenants/${t.id}/delete`}
                      className={cn(
                        "inline-flex items-center rounded-lg border px-3 py-2 text-xs font-semibold",
                        "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/60"
                      )}
                    >
                      Archive
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-4 py-8 text-sm text-gray-600 dark:text-gray-300">No tenants found.</div>
        )}
      </div>
    </div>
  );
}