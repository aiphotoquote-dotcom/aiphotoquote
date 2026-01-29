// src/app/pcc/tenants/[tenantId]/page.tsx
import React from "react";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { tenantPlans } from "@/lib/db/pccSchema";
import { requirePlatformRole } from "@/lib/rbac/guards";
import { eq } from "drizzle-orm";

export default async function PccTenantDetailPage({ params }: { params: { tenantId: string } }) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

  const tenantId = String(params.tenantId);

  const tRows = await db.select().from(tenants).where(eq(tenants.id as any, tenantId as any)).limit(1);
  const t = tRows[0];

  if (!t) {
    return (
      <main className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">Tenant not found</div>
        <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">{tenantId}</div>
      </main>
    );
  }

  const pRows = await db.select().from(tenantPlans).where(eq(tenantPlans.tenantId, tenantId as any)).limit(1);
  const plan = pRows[0] ?? null;

  return (
    <main className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="text-xs text-gray-600 dark:text-gray-300">Tenant</div>
        <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">{t.name ?? t.slug}</div>
        <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          <span className="font-semibold">ID:</span> {t.id}
        </div>
        {t.slug ? (
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            <span className="font-semibold">Slug:</span> {t.slug}
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">Plan (billing-ready)</div>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
            <div className="text-xs text-gray-600 dark:text-gray-300">Plan</div>
            <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100">{plan?.planKey ?? "free"}</div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
            <div className="text-xs text-gray-600 dark:text-gray-300">Status</div>
            <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100">{plan?.status ?? "active"}</div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
            <div className="text-xs text-gray-600 dark:text-gray-300">Seats limit</div>
            <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100">
              {Number.isFinite(plan?.seatsLimit) ? plan?.seatsLimit : "—"}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
            <div className="text-xs text-gray-600 dark:text-gray-300">Renders included</div>
            <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100">
              {Number.isFinite(plan?.rendersIncluded) ? plan?.rendersIncluded : "—"}
            </div>
          </div>
        </div>

        <div className="mt-3 text-xs text-gray-600 dark:text-gray-300">
          Editing UI comes next. For v1 this page proves access + data shape.
        </div>
      </div>
    </main>
  );
}