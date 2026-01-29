// src/app/pcc/tenants/[tenantId]/page.tsx
import React from "react";
import Link from "next/link";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  tenants,
  tenantMembers,
  tenantSettings,
} from "@/lib/db/schema";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";

function fmt(d: any) {
  try {
    const dt = d instanceof Date ? d : new Date(d);
    if (!Number.isFinite(dt.getTime())) return "";
    return dt.toLocaleString();
  } catch {
    return "";
  }
}

export default async function PccTenantDetailPage({
  params,
}: {
  params: { tenantId: string };
}) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const tenantId = params.tenantId;

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenant) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
        Tenant not found.
      </div>
    );
  }

  const members = await db
    .select()
    .from(tenantMembers)
    .where(eq(tenantMembers.tenantId, tenantId));

  const [settings] = await db
    .select()
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId))
    .limit(1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {tenant.name}
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Tenant detail (read-only)
            </p>
          </div>

          <Link
            href="/pcc/tenants"
            className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold dark:border-gray-800"
          >
            Back to tenants
          </Link>
        </div>
      </div>

      {/* Identity */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Identity</h2>

        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
          <div>
            <dt className="text-gray-500 dark:text-gray-400">Tenant ID</dt>
            <dd className="font-mono text-gray-900 dark:text-gray-100">{tenant.id}</dd>
          </div>

          <div>
            <dt className="text-gray-500 dark:text-gray-400">Slug</dt>
            <dd className="text-gray-900 dark:text-gray-100">{tenant.slug}</dd>
          </div>

          <div>
            <dt className="text-gray-500 dark:text-gray-400">Owner (portable)</dt>
            <dd className="text-gray-900 dark:text-gray-100">
              {tenant.ownerUserId ?? "—"}
            </dd>
          </div>

          <div>
            <dt className="text-gray-500 dark:text-gray-400">Owner (legacy Clerk)</dt>
            <dd className="text-gray-900 dark:text-gray-100">
              {tenant.ownerClerkUserId ?? "—"}
            </dd>
          </div>

          <div>
            <dt className="text-gray-500 dark:text-gray-400">Created</dt>
            <dd className="text-gray-900 dark:text-gray-100">
              {fmt(tenant.createdAt)}
            </dd>
          </div>
        </dl>
      </div>

      {/* Members */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">
          Members ({members.length})
        </h2>

        <div className="mt-3 space-y-2">
          {members.length ? (
            members.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-gray-800"
              >
                <div className="font-mono text-xs text-gray-700 dark:text-gray-200">
                  {m.userId ?? "—"}
                </div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                  {m.role}
                </div>
              </div>
            ))
          ) : (
            <div className="text-sm text-gray-600 dark:text-gray-300">
              No members found.
            </div>
          )}
        </div>
      </div>

      {/* Settings snapshot */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">
          Settings snapshot
        </h2>

        {settings ? (
          <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-gray-500 dark:text-gray-400">Industry</dt>
              <dd className="text-gray-900 dark:text-gray-100">
                {settings.industryKey}
              </dd>
            </div>

            <div>
              <dt className="text-gray-500 dark:text-gray-400">AI mode</dt>
              <dd className="text-gray-900 dark:text-gray-100">
                {settings.aiMode ?? "default"}
              </dd>
            </div>

            <div>
              <dt className="text-gray-500 dark:text-gray-400">Pricing enabled</dt>
              <dd className="text-gray-900 dark:text-gray-100">
                {settings.pricingEnabled ? "Yes" : "No"}
              </dd>
            </div>

            <div>
              <dt className="text-gray-500 dark:text-gray-400">Rendering enabled</dt>
              <dd className="text-gray-900 dark:text-gray-100">
                {settings.renderingEnabled ? "Yes" : "No"}
              </dd>
            </div>
          </dl>
        ) : (
          <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">
            No tenant_settings row found.
          </div>
        )}
      </div>

      {/* Future links */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">
          Platform controls
        </h2>

        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-xl border border-gray-200 px-3 py-2 text-xs dark:border-gray-800">
            Industry manager (coming)
          </span>
          <span className="rounded-xl border border-gray-200 px-3 py-2 text-xs dark:border-gray-800">
            LLM / guardrails (coming)
          </span>
          <span className="rounded-xl border border-gray-200 px-3 py-2 text-xs dark:border-gray-800">
            Billing (coming)
          </span>
        </div>
      </div>
    </div>
  );
}