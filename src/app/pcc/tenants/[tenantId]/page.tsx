// src/app/pcc/tenants/[tenantId]/page.tsx
import React from "react";
import Link from "next/link";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";
import AdminControls from "./AdminControls";

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

function initials(name: string) {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  const letters = parts.map((p) => p.slice(0, 1).toUpperCase()).join("");
  return letters || "T";
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

type TenantSettingsRow = {
  planTier: string;
  monthlyQuoteLimit: number | null;
  activationGraceCredits: number;
  activationGraceUsed: number;
  planSelectedAt: Date | null;
  brandLogoUrl: string | null;
  brandLogoVariant: string | null;
  leadToEmail: string | null;
  businessName: string | null;
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

async function loadSettings(tenantId: string): Promise<TenantSettingsRow | null> {
  // tenant_settings has tenant_id PK; may not exist in early tenants — handle gracefully.
  const r = await db.execute(sql`
    select
      plan_tier as "planTier",
      monthly_quote_limit as "monthlyQuoteLimit",
      activation_grace_credits as "activationGraceCredits",
      activation_grace_used as "activationGraceUsed",
      plan_selected_at as "planSelectedAt",
      brand_logo_url as "brandLogoUrl",
      brand_logo_variant as "brandLogoVariant",
      lead_to_email as "leadToEmail",
      business_name as "businessName"
    from tenant_settings
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);

  const row = firstRow(r);
  if (!row) return null;

  return {
    planTier: String(row.planTier ?? "free"),
    monthlyQuoteLimit:
      row.monthlyQuoteLimit === null || row.monthlyQuoteLimit === undefined ? null : Number(row.monthlyQuoteLimit),
    activationGraceCredits: Number(row.activationGraceCredits ?? 0),
    activationGraceUsed: Number(row.activationGraceUsed ?? 0),
    planSelectedAt: row.planSelectedAt ? new Date(row.planSelectedAt) : null,
    brandLogoUrl: row.brandLogoUrl ? String(row.brandLogoUrl) : null,
    brandLogoVariant: row.brandLogoVariant ? String(row.brandLogoVariant) : null,
    leadToEmail: row.leadToEmail ? String(row.leadToEmail) : null,
    businessName: row.businessName ? String(row.businessName) : null,
  };
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
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

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

  const [tenant, settings, members] = await Promise.all([loadTenant(tid), loadSettings(tid), loadMembers(tid)]);

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
  const planTier = settings?.planTier ?? "free";
  const quoteLimit = settings?.monthlyQuoteLimit ?? null;
  const graceTotal = settings?.activationGraceCredits ?? 0;
  const graceUsed = settings?.activationGraceUsed ?? 0;
  const graceRemaining = Math.max(0, graceTotal - graceUsed);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-4">
      <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex items-start gap-4">
            {/* Logo */}
            <div className="shrink-0">
              {settings?.brandLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={settings.brandLogoUrl}
                  alt={`${tenant.name} logo`}
                  className="h-14 w-14 rounded-2xl border border-gray-200 bg-white object-cover dark:border-gray-800"
                />
              ) : (
                <div className="h-14 w-14 rounded-2xl border border-gray-200 bg-gray-50 flex items-center justify-center text-sm font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
                  {initials(tenant.name)}
                </div>
              )}
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
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

                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100">
                  PLAN: <span className="ml-1 font-mono">{planTier}</span>
                </span>

                <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-900 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-100">
                  GRACE:{" "}
                  <span className="ml-1 font-mono">
                    {graceRemaining}/{graceTotal}
                  </span>
                </span>
              </div>

              <div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100 truncate">
                {settings?.businessName?.trim() || tenant.name}
              </div>

              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                <span className="font-mono text-xs">{tenant.slug}</span>
                {settings?.leadToEmail ? (
                  <>
                    <span className="mx-2 text-gray-300 dark:text-gray-700">•</span>
                    <span className="text-xs">{settings.leadToEmail}</span>
                  </>
                ) : null}
              </div>

              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                ID: <span className="font-mono">{tenant.id}</span>
              </div>

              <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
                {tenant.createdAt ? <div>Created: {fmtDate(tenant.createdAt)}</div> : null}
                {settings?.planSelectedAt ? <div>Plan selected: {fmtDate(settings.planSelectedAt)}</div> : null}
                {isArchived && tenant.archivedAt ? <div>Archived: {fmtDate(tenant.archivedAt)}</div> : null}
                <div>
                  Quote limit:{" "}
                  <span className="font-mono">{quoteLimit === null ? "unlimited" : String(quoteLimit)}</span>
                </div>
              </div>
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
                  "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100 dark:hover:bg-amber-950/50"
                )}
              >
                {isArchived ? "View archive" : "Archive"}
              </Link>
            </div>
          </div>
        </div>

        {isArchived ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
            This tenant is archived. It should not appear in normal app flows. Historical data remains available for
            audit.
          </div>
        ) : null}
      </div>

      {/* Admin controls */}
      <AdminControls
        tenantId={tenant.id}
        isArchived={isArchived}
        initial={{
          planTier,
          monthlyQuoteLimit: quoteLimit,
          activationGraceCredits: graceTotal,
          activationGraceUsed: graceUsed,
          brandLogoUrl: settings?.brandLogoUrl ?? null,
          brandLogoVariant: settings?.brandLogoVariant ?? null,
        }}
      />

      {/* Members */}
      <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
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
  );
}