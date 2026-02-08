// src/app/pcc/tenants/[tenantId]/page.tsx
import React from "react";
import Link from "next/link";
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
    // Drizzle node-postgres adapter usually returns { rows: [...] }
    if (typeof r === "object" && r !== null && Array.isArray((r as any).rows)) return (r as any).rows[0] ?? null;
    return null;
  } catch {
    return null;
  }
}

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function fmtDate(d: any) {
  try {
    if (!d) return "";
    const dt = d instanceof Date ? d : new Date(d);
    if (!Number.isFinite(dt.getTime())) return "";
    return dt.toLocaleString();
  } catch {
    return "";
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

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  ownerClerkUserId: string | null;
  createdAt: Date | null;
  status: "active" | "archived" | string;
  archivedAt: Date | null;
};

async function loadTenant(tenantId: string): Promise<TenantRow | null> {
  const r = await db.execute(sql`
    select
      id,
      name,
      slug,
      owner_clerk_user_id,
      created_at,
      status,
      archived_at
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
        status: row.status ? String(row.status) : "active",
        archivedAt: row.archived_at ? new Date(row.archived_at) : null,
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

  const rows = Array.isArray(r) ? r : (r as any)?.rows ?? [];
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

  const isArchived = String(tenant.status).toLowerCase() === "archived";

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="text-xs text-gray-600 dark:text-gray-300">Tenant</div>
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                  isArchived
                    ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
                    : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
                )}
              >
                {isArchived ? "ARCHIVED" : "ACTIVE"}
              </span>
            </div>

            <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100 truncate">{tenant.name}</div>

            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              <span className="font-mono text-xs">{tenant.slug}</span>
            </div>

            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              ID: <span className="font-mono">{tenant.id}</span>
            </div>

            <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
              {tenant.createdAt ? <div>Created: {fmtDate(tenant.createdAt)}</div> : null}
              {isArchived && tenant.archivedAt ? <div>Archived: {fmtDate(tenant.archivedAt)}</div> : null}
            </div>
          </div>

          <div className="shrink-0 text-right space-y-3">
            <div>
              <div className="text-xs text-gray-600 dark:text-gray-300">Owner (Clerk)</div>
              <div className="mt-1 font-mono text-xs text-gray-900 dark:text-gray-100">
                {tenant.ownerClerkUserId ?? "(none)"}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Link
                href="/pcc/tenants"
                className={cn(
                  "inline-flex items-center rounded-xl border px-3 py-2 text-xs font-semibold",
                  "border-gray-200 bg-white text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-950"
                )}
              >
                Back
              </Link>

              <Link
                href={`/pcc/tenants/${encodeURIComponent(tenant.id)}/delete`}
                className={cn(
                  "inline-flex items-center rounded-xl border px-3 py-2 text-xs font-semibold",
                  isArchived
                    ? "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100 dark:hover:bg-amber-950/50"
                    : "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100 dark:hover:bg-amber-950/50"
                )}
              >
                {isArchived ? "View archive" : "Archive"}
              </Link>
            </div>
          </div>
        </div>

        {isArchived ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
            This tenant is archived. It should not appear in normal app flows. Historical data remains available for audit.
          </div>
        ) : null}

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