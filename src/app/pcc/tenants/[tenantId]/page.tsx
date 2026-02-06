// src/app/pcc/tenants/[tenantId]/page.tsx
import React from "react";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function firstRow(r: any): any | null {
  try {
    if (!r) return null;
    if (Array.isArray(r)) return r[0] ?? null;
    if (typeof r === "object" && r !== null && 0 in r) return (r as any)[0] ?? null;
    return null;
  } catch {
    return null;
  }
}

type MemberRow = {
  tenantId: string;
  clerkUserId: string;
  role: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

async function loadTenant(tenantId: string) {
  const r = await db.execute(sql`
    select
      id,
      name,
      slug,
      owner_clerk_user_id,
      created_at
    from tenants
    where id = ${tenantId}::uuid
    limit 1
  `);

  const row = firstRow(r);
  return row
    ? {
        id: String(row.id),
        name: String(row.name ?? ""),
        slug: String(row.slug ?? ""),
        ownerClerkUserId: row.owner_clerk_user_id ? String(row.owner_clerk_user_id) : null,
        createdAt: row.created_at ? new Date(row.created_at) : null,
      }
    : null;
}

async function loadMembers(tenantId: string): Promise<MemberRow[]> {
  const r = await db.execute(sql`
    select
      tenant_id as "tenantId",
      clerk_user_id as "clerkUserId",
      role,
      status,
      created_at as "createdAt",
      updated_at as "updatedAt"
    from tenant_members
    where tenant_id = ${tenantId}::uuid
    order by created_at asc
  `);

  const rows = Array.isArray(r) ? r : [];
  return rows.map((x: any) => ({
    tenantId: String(x.tenantId ?? tenantId),
    clerkUserId: String(x.clerkUserId ?? ""),
    role: String(x.role ?? ""),
    status: String(x.status ?? ""),
    createdAt: x.createdAt ? new Date(x.createdAt) : new Date(0),
    updatedAt: x.updatedAt ? new Date(x.updatedAt) : new Date(0),
  }));
}

export default async function TenantDetailPage(props: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await props.params;
  const tid = safeTrim(tenantId);

  if (!tid) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          Missing tenantId.
        </div>
      </div>
    );
  }

  const [tenant, members] = await Promise.all([loadTenant(tid), loadMembers(tid)]);

  if (!tenant) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          Tenant not found.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs text-gray-600 dark:text-gray-300">Tenant</div>
            <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">{tenant.name}</div>
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              <span className="font-mono text-xs">{tenant.slug}</span>
            </div>
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              ID: <span className="font-mono">{tenant.id}</span>
            </div>
          </div>

          <div className="shrink-0 text-right">
            <div className="text-xs text-gray-600 dark:text-gray-300">Owner (Clerk)</div>
            <div className="mt-1 font-mono text-xs text-gray-900 dark:text-gray-100">
              {tenant.ownerClerkUserId ?? "(none)"}
            </div>
          </div>
        </div>

        <div className="mt-8">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Members</div>
          <div className="mt-3 grid gap-2">
            {members.length ? (
              members.map((m) => (
                <div
                  key={`${m.tenantId}:${m.clerkUserId}`} // ✅ tenant_members has no id; use composite key
                  className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-gray-800"
                >
                  <div className="font-mono text-xs text-gray-700 dark:text-gray-200">{m.clerkUserId}</div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="rounded-lg border border-gray-200 px-2 py-1 dark:border-gray-800">{m.role}</span>
                    <span className="rounded-lg border border-gray-200 px-2 py-1 dark:border-gray-800">{m.status}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
                No members found.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}