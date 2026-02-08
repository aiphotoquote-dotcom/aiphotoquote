// src/app/pcc/tenants/page.tsx
import React from "react";
import Link from "next/link";
import { desc, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants, tenantSettings } from "@/lib/db/schema";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function normalizePlan(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "free";
  if (s === "tier0") return "free";
  if (s === "tier1") return "tier1";
  if (s === "tier2") return "tier2";
  return s;
}

function StatusPill({ status, archivedAt }: { status: string; archivedAt: any }) {
  const isArchived = String(status ?? "").toLowerCase() === "archived";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        isArchived
          ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
          : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
      )}
      title={isArchived && archivedAt ? `Archived: ${fmtDate(archivedAt)}` : undefined}
    >
      {isArchived ? "ARCHIVED" : "ACTIVE"}
    </span>
  );
}

function PlanPill({ plan }: { plan: string }) {
  const p = normalizePlan(plan);
  const label = p === "free" ? "FREE" : p.toUpperCase();
  const tone =
    p === "free"
      ? "border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
      : p === "tier1"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
      : "border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-100";

  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", tone)}>{label}</span>;
}

export default async function PccTenantsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const sp = (await props.searchParams) ?? {};
  const showArchived =
    sp.archived === "1" ||
    sp.archived === "true" ||
    (Array.isArray(sp.archived) && sp.archived.includes("1"));

  // NOTE: tenants table now has status/archived_at per your DB checks.
  // tenant_settings is left-joined for plan + limits.
  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      ownerUserId: tenants.ownerUserId,
      ownerClerkUserId: tenants.ownerClerkUserId,
      createdAt: tenants.createdAt,

      // archive/status fields (these must exist in DB; you've proven they do)
      status: sql<string>`coalesce(${(tenants as any).status}, 'active')`,
      archivedAt: (tenants as any).archivedAt ?? (tenants as any).archived_at,

      // plan + credits from tenant_settings
      planTier: tenantSettings.planTier,
      monthlyQuoteLimit: tenantSettings.monthlyQuoteLimit,
      activationGraceCredits: tenantSettings.activationGraceCredits,
      activationGraceUsed: tenantSettings.activationGraceUsed,
    })
    .from(tenants)
    .leftJoin(tenantSettings, sql`${tenantSettings.tenantId} = ${tenants.id}`)
    .where(
      showArchived
        ? sql`true`
        : sql`coalesce(${(tenants as any).status}, 'active') <> 'archived'`
    )
    .orderBy(desc(tenants.createdAt))
    .limit(200);

  const activeCount = showArchived ? null : rows.length;

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

              {activeCount !== null ? (
                <span className="text-gray-400 dark:text-gray-500">Archived tenants hidden by default</span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
        <div className="grid grid-cols-12 gap-0 border-b border-gray-200 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
          <div className="col-span-4">Tenant</div>
          <div className="col-span-3">Slug</div>
          <div className="col-span-3">Plan / Credits</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        {rows.length ? (
          <div className="divide-y divide-gray-200 dark:divide-gray-800">
            {rows.map((t: any) => {
              const owner = t.ownerUserId
                ? `user:${String(t.ownerUserId).slice(0, 8)}`
                : t.ownerClerkUserId
                ? `clerk:${String(t.ownerClerkUserId).slice(0, 8)}`
                : "—";

              const plan = normalizePlan(t.planTier ?? "free");
              const limit =
                t.monthlyQuoteLimit === null || t.monthlyQuoteLimit === undefined
                  ? "∞"
                  : String(t.monthlyQuoteLimit);

              const graceTotal = Number(t.activationGraceCredits ?? 0);
              const graceUsed = Number(t.activationGraceUsed ?? 0);
              const graceLeft = Math.max(0, graceTotal - graceUsed);

              const isArchived = String(t.status ?? "").toLowerCase() === "archived";

              return (
                <div key={t.id} className="grid grid-cols-12 gap-0 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900">
                  <div className="col-span-4 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="truncate font-semibold text-gray-900 dark:text-gray-100">{t.name}</div>
                      <StatusPill status={t.status ?? "active"} archivedAt={t.archivedAt} />
                    </div>
                    <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                      {String(t.id).slice(0, 8)} · {fmtDate(t.createdAt)}
                      {isArchived && t.archivedAt ? ` · archived ${fmtDate(t.archivedAt)}` : ""}
                    </div>
                  </div>

                  <div className="col-span-3 min-w-0 truncate text-sm text-gray-700 dark:text-gray-200">{t.slug}</div>

                  <div className="col-span-3 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <PlanPill plan={plan} />
                      <span className="text-xs text-gray-600 dark:text-gray-300">
                        Limit: <span className="font-mono">{limit}</span>
                      </span>
                      <span className="text-xs text-gray-600 dark:text-gray-300">
                        Grace: <span className="font-mono">{graceLeft}</span>
                      </span>
                    </div>
                    <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                      Owner: <span className="font-mono">{owner}</span>
                    </div>
                  </div>

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
                      {isArchived ? "View archive" : "Archive"}
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