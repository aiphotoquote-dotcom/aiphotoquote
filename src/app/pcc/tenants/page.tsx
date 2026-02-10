// src/app/pcc/tenants/page.tsx
import React from "react";
import Link from "next/link";
import { desc, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants, tenantSettings } from "@/lib/db/schema";
import { requirePlatformRole } from "@/lib/rbac/guards";
import TenantsTableClient from "./TenantsTableClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PccTenantsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const sp = (await props.searchParams) ?? {};
  const showArchived =
    sp.archived === "1" ||
    sp.archived === "true" ||
    (Array.isArray(sp.archived) && sp.archived.includes("1"));

  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      ownerUserId: tenants.ownerUserId,
      ownerClerkUserId: tenants.ownerClerkUserId,
      createdAt: tenants.createdAt,

      status: sql<string>`coalesce(${(tenants as any).status}, 'active')`,
      archivedAt: (tenants as any).archivedAt ?? (tenants as any).archived_at,

      planTier: tenantSettings.planTier,
      monthlyQuoteLimit: tenantSettings.monthlyQuoteLimit,
      activationGraceCredits: tenantSettings.activationGraceCredits,
      activationGraceUsed: tenantSettings.activationGraceUsed,
    })
    .from(tenants)
    .leftJoin(tenantSettings, sql`${tenantSettings.tenantId} = ${tenants.id}`)
    .where(showArchived ? sql`true` : sql`coalesce(${(tenants as any).status}, 'active') <> 'archived'`)
    .orderBy(desc(tenants.createdAt))
    .limit(200);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Tenants</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              PCC tenant list. Use <span className="font-semibold">Archive</span> to safely disable a tenant while preserving history (no data is deleted).
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1 dark:border-gray-800 dark:bg-gray-900">
                Showing {rows.length} {rows.length === 1 ? "tenant" : "tenants"}
              </span>

              {showArchived ? (
                <Link
                  href="/pcc/tenants"
                  className="rounded-full border border-gray-200 bg-white px-2 py-1 font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-200 dark:hover:bg-gray-950"
                >
                  Hide archived
                </Link>
              ) : (
                <Link
                  href="/pcc/tenants?archived=1"
                  className="rounded-full border border-gray-200 bg-white px-2 py-1 font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-200 dark:hover:bg-gray-950"
                >
                  Show archived
                </Link>
              )}

              {!showArchived ? <span className="text-gray-400 dark:text-gray-500">Archived tenants hidden by default</span> : null}
            </div>
          </div>
        </div>
      </div>

      <TenantsTableClient rows={rows as any} showArchived={showArchived} />
    </div>
  );
}