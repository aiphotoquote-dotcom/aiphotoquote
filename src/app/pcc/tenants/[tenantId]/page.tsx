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
    if (typeof r === "object" && r !== null && Array.isArray((r as any).rows)) return (r as any).rows[0] ?? null;
    if (typeof r === "object" && r !== null && 0 in r) return (r as any)[0] ?? null;
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

type SettingsRow = {
  planTier: string;
  monthlyQuoteLimit: number | null;
  activationGraceCredits: number;
  activationGraceUsed: number;
  brandLogoUrl: string | null;
  brandLogoVariant: string | null;

  industryKey: string | null;
  aiMode: string | null;
  pricingEnabled: boolean | null;
  updatedAt: Date | null;
};

function normalizeTier(v: unknown): "tier0" | "tier1" | "tier2" {
  const s = String(v ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (s === "free") return "tier0";
  if (s === "tier0" || s === "tier1" || s === "tier2") return s as any;
  return "tier0";
}

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

async function loadSettings(tenantId: string): Promise<SettingsRow | null> {
  const r = await db.execute(sql`
    select
      ts.plan_tier as "planTier",
      ts.monthly_quote_limit as "monthlyQuoteLimit",
      ts.activation_grace_credits as "activationGraceCredits",
      ts.activation_grace_used as "activationGraceUsed",
      ts.brand_logo_url as "brandLogoUrl",
      ts.brand_logo_variant as "brandLogoVariant",
      ts.industry_key as "industryKey",
      ts.ai_mode as "aiMode",
      ts.pricing_enabled as "pricingEnabled",
      ts.updated_at as "updatedAt"
    from tenant_settings ts
    where ts.tenant_id = ${tenantId}::uuid
    limit 1
  `);

  const row = firstRow(r);
  if (!row) return null;

  return {
    planTier: String(row.planTier ?? "tier0"),
    monthlyQuoteLimit: row.monthlyQuoteLimit === null || row.monthlyQuoteLimit === undefined ? null : Number(row.monthlyQuoteLimit),
    activationGraceCredits: Number(row.activationGraceCredits ?? 0),
    activationGraceUsed: Number(row.activationGraceUsed ?? 0),
    brandLogoUrl: row.brandLogoUrl ? String(row.brandLogoUrl) : null,
    brandLogoVariant: row.brandLogoVariant ? String(row.brandLogoVariant) : null,
    industryKey: row.industryKey ? String(row.industryKey) : null,
    aiMode: row.aiMode ? String(row.aiMode) : null,
    pricingEnabled: row.pricingEnabled === null || row.pricingEnabled === undefined ? null : Boolean(row.pricingEnabled),
    updatedAt: row.updatedAt ? new Date(row.updatedAt) : null,
  };
}

async function loadOnboardingAnalysis(tenantId: string): Promise<any | null> {
  const r = await db.execute(sql`
    select ai_analysis as "aiAnalysis"
    from tenant_onboarding
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);

  const row = firstRow(r);
  return row?.aiAnalysis ?? null;
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

function pick(obj: any, paths: string[]): any {
  for (const p of paths) {
    const parts = p.split(".");
    let cur = obj;
    let ok = true;
    for (const k of parts) {
      if (!cur || typeof cur !== "object" || !(k in cur)) {
        ok = false;
        break;
      }
      cur = cur[k];
    }
    if (ok) return cur;
  }
  return null;
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

  const [tenant, settings, onboarding, members] = await Promise.all([
    loadTenant(tid),
    loadSettings(tid),
    loadOnboardingAnalysis(tid),
    loadMembers(tid),
  ]);

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

  const planTier = normalizeTier(settings?.planTier ?? "tier0");
  const monthlyLimit = settings?.monthlyQuoteLimit ?? null;
  const graceTotal = settings?.activationGraceCredits ?? 0;
  const graceUsed = settings?.activationGraceUsed ?? 0;
  const graceRemaining = Math.max(0, graceTotal - graceUsed);

  // Onboarding AI fields (best-effort, since json shape may evolve)
  const whatTheyDo =
    pick(onboarding, ["business_summary", "summary", "what_it_does", "analysis.summary", "analysis.business_summary"]) ??
    null;

  const confidence =
    pick(onboarding, ["confidence", "analysis.confidence", "classification.confidence"]) ?? null;

  const website =
    pick(onboarding, ["website", "site", "url", "analysis.website", "analysis.url"]) ?? null;

  const industries =
    pick(onboarding, ["industry", "industry_key", "analysis.industry", "analysis.industry_key"]) ?? null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-4">
      {/* Header */}
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
              <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-semibold text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-200">
                {planTier}
              </span>
            </div>

            <div className="mt-2 flex items-start gap-3">
              {/* Logo */}
              {settings?.brandLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={settings.brandLogoUrl}
                  alt={`${tenant.name} logo`}
                  className="h-12 w-12 rounded-xl border border-gray-200 bg-white object-contain p-1 dark:border-gray-800 dark:bg-black"
                />
              ) : (
                <div className="h-12 w-12 rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-black" />
              )}

              <div className="min-w-0">
                <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100 truncate">{tenant.name}</div>
                <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  <span className="font-mono text-xs">{tenant.slug}</span>
                </div>
                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  ID: <span className="font-mono">{tenant.id}</span>
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
              {tenant.createdAt ? <div>Created: {fmtDate(tenant.createdAt)}</div> : null}
              {settings?.updatedAt ? <div>Settings updated: {fmtDate(settings.updatedAt)}</div> : null}
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
            This tenant is archived. It should not appear in normal app flows. Historical data remains available for audit.
          </div>
        ) : null}
      </div>

      {/* Plan / Credits Summary */}
      <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Plan & credits</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Monthly quote limit</div>
            <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
              {monthlyLimit === null ? "Unlimited" : monthlyLimit}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Grace credits</div>
            <div className="mt-1 text-sm text-gray-700 dark:text-gray-200">
              Total <span className="font-mono">{graceTotal}</span> · Used{" "}
              <span className="font-mono">{graceUsed}</span> · Remaining{" "}
              <span className="font-mono">{graceRemaining}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Onboarding AI Analysis */}
      <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Onboarding AI analysis</div>
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Snapshot captured during onboarding (tenant_onboarding.ai_analysis).
            </div>
          </div>
          {confidence ? (
            <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-semibold text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-200">
              confidence: {String(confidence)}
            </span>
          ) : null}
        </div>

        <div className="mt-4 grid gap-3">
          {website ? (
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-black">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Website</div>
              <div className="mt-1 font-mono text-xs text-gray-700 dark:text-gray-200 break-all">{String(website)}</div>
            </div>
          ) : null}

          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-black">
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">What the business does</div>
            <div className="mt-1 text-sm text-gray-800 dark:text-gray-200">
              {whatTheyDo ? String(whatTheyDo) : <span className="text-gray-500">No summary found in ai_analysis.</span>}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-black">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Industry (settings)</div>
              <div className="mt-1 font-mono text-xs text-gray-700 dark:text-gray-200">
                {settings?.industryKey ?? "—"}
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-black">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Industry (AI guess)</div>
              <div className="mt-1 font-mono text-xs text-gray-700 dark:text-gray-200">
                {industries ? String(industries) : "—"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Admin controls */}
      <AdminControls
        tenantId={tenant.id}
        isArchived={isArchived}
        initial={{
          planTier: planTier,
          monthlyQuoteLimit: monthlyLimit,
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
                key={`${m.tenantId}:${m.clerkUserId}`}
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