// src/app/pcc/tenants/TenantsTableClient.tsx
"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function normalizePlan(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "free";
  if (s === "tier0") return "free";
  if (s === "tier1") return "tier1";
  if (s === "tier2") return "tier2";
  return s;
}

function toBool(v: any) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v ?? "").toLowerCase().trim();
  return s === "true" || s === "t" || s === "1" || s === "yes";
}

function StatusPill({ status, archivedAt }: { status: string; archivedAt: any }) {
  const isArchived = String(status ?? "").toLowerCase() === "archived";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold",
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

  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold", tone)}>
      {label}
    </span>
  );
}

function SmallPill({
  label,
  tone = "neutral",
  title,
}: {
  label: string;
  tone?: "neutral" | "good" | "warn" | "bad" | "info" | "purple";
  title?: string;
}) {
  const cls =
    tone === "good"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
        : tone === "bad"
          ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200"
          : tone === "info"
            ? "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-100"
            : tone === "purple"
              ? "border-purple-200 bg-purple-50 text-purple-900 dark:border-purple-900/40 dark:bg-purple-950/30 dark:text-purple-100"
              : "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-200";

  return (
    <span
      className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", cls)}
      title={title}
    >
      {label}
    </span>
  );
}

type Row = {
  id: string;
  name: string | null;
  slug: string | null;
  ownerUserId?: any;
  ownerClerkUserId?: any;
  createdAt?: any;

  status?: string | null;
  archivedAt?: any;

  planTier?: any;
  monthlyQuoteLimit?: any;
  activationGraceCredits?: any;
  activationGraceUsed?: any;

  industryKey?: string | null;
  industryLabel?: string | null;

  aiSuggestedIndustryKey?: string | null;
  aiSuggestedIndustryLabel?: string | null;
  aiNeedsConfirmation?: any;
  aiStatus?: string | null;
  aiSource?: string | null;
  aiUpdatedAt?: string | null;
  aiRejectedCount?: any;
};

type StatusFilter = "all" | "active" | "archived";
type AiFilter = "all" | "ready" | "needs_confirm" | "attention";

function getOwnerLabel(t: Row) {
  if (t.ownerUserId) return `user:${String(t.ownerUserId).slice(0, 8)}`;
  if (t.ownerClerkUserId) return `clerk:${String(t.ownerClerkUserId).slice(0, 8)}`;
  return "—";
}

function getGraceLeft(t: Row) {
  const graceTotal = Number(t.activationGraceCredits ?? 0);
  const graceUsed = Number(t.activationGraceUsed ?? 0);
  return Math.max(0, graceTotal - graceUsed);
}

function getLimitLabel(t: Row) {
  return t.monthlyQuoteLimit === null || t.monthlyQuoteLimit === undefined ? "∞" : String(t.monthlyQuoteLimit);
}

function getAiDerived(t: Row) {
  const settingsIndustryKey = safeTrim(t.industryKey ?? "");
  const aiKey = safeTrim(t.aiSuggestedIndustryKey ?? "");
  const aiStatus = safeTrim(t.aiStatus ?? "").toLowerCase();
  const needsConfirm = toBool(t.aiNeedsConfirmation);
  const rejectedCount = Number(t.aiRejectedCount ?? 0);
  const graceLeft = getGraceLeft(t);

  const correctness =
    settingsIndustryKey && aiKey
      ? settingsIndustryKey === aiKey
        ? "correct"
        : "mismatch"
      : "unknown";

  const needsAttention =
    needsConfirm ||
    aiStatus === "error" ||
    aiStatus === "rejected" ||
    (!settingsIndustryKey && !aiKey) ||
    graceLeft <= 3;

  const ready = aiStatus === "complete" && !needsConfirm;

  return {
    settingsIndustryKey,
    aiKey,
    aiStatus,
    needsConfirm,
    rejectedCount,
    correctness,
    needsAttention,
    ready,
    graceLeft,
  };
}

export default function TenantsTableClient({ rows, showArchived }: { rows: Row[]; showArchived: boolean }) {
  const router = useRouter();

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [impersonatingTenantId, setImpersonatingTenantId] = useState<string | null>(null);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [aiFilter, setAiFilter] = useState<AiFilter>("all");
  const [page, setPage] = useState(1);

  const selectedIds = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);
  const selectedCount = selectedIds.length;
  const pageSize = 8;

  const filteredRows = useMemo(() => {
    const q = safeTrim(search).toLowerCase();

    return rows.filter((t) => {
      const isArchived = String(t.status ?? "").toLowerCase() === "archived";
      const owner = getOwnerLabel(t);
      const derived = getAiDerived(t);

      if (statusFilter === "active" && isArchived) return false;
      if (statusFilter === "archived" && !isArchived) return false;

      if (aiFilter === "ready" && !derived.ready) return false;
      if (aiFilter === "needs_confirm" && !derived.needsConfirm) return false;
      if (aiFilter === "attention" && !derived.needsAttention) return false;

      if (!q) return true;

      const haystack = [
        t.name ?? "",
        t.slug ?? "",
        t.id ?? "",
        owner,
        t.industryKey ?? "",
        t.industryLabel ?? "",
        t.aiSuggestedIndustryKey ?? "",
        t.aiSuggestedIndustryLabel ?? "",
        t.aiStatus ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [rows, search, statusFilter, aiFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));

  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page]);

  const selectableRows = useMemo(() => {
    return filteredRows.filter((r) => String(r.status ?? "active").toLowerCase() !== "archived");
  }, [filteredRows]);

  const allSelectableIds = useMemo(() => selectableRows.map((r) => String(r.id)), [selectableRows]);
  const allChecked = allSelectableIds.length > 0 && allSelectableIds.every((id) => Boolean(selected[id]));
  const someChecked = allSelectableIds.some((id) => Boolean(selected[id])) && !allChecked;

  const confirmPhrase = useMemo(
    () => `ARCHIVE ${selectedCount} TENANT${selectedCount === 1 ? "" : "S"}`,
    [selectedCount]
  );

  const canConfirm = selectedCount > 0 && confirmText.trim() === confirmPhrase;

  const counts = useMemo(() => {
    const active = rows.filter((r) => String(r.status ?? "active").toLowerCase() !== "archived").length;
    const archived = rows.filter((r) => String(r.status ?? "").toLowerCase() === "archived").length;
    const ready = rows.filter((r) => getAiDerived(r).ready).length;
    const needsConfirm = rows.filter((r) => getAiDerived(r).needsConfirm).length;
    const attention = rows.filter((r) => getAiDerived(r).needsAttention).length;

    return { active, archived, ready, needsConfirm, attention };
  }, [rows]);

  function toggleAll() {
    if (allChecked) {
      const next = { ...selected };
      for (const id of allSelectableIds) delete next[id];
      setSelected(next);
      return;
    }
    const next = { ...selected };
    for (const id of allSelectableIds) next[id] = true;
    setSelected(next);
  }

  function toggleOne(id: string, on: boolean) {
    setSelected((prev) => {
      const next = { ...prev };
      if (on) next[id] = true;
      else delete next[id];
      return next;
    });
  }

  async function bulkArchive() {
    if (!selectedCount) return;
    setWorking(true);
    setErr(null);

    try {
      const res = await fetch("/api/pcc/tenants/bulk-archive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          tenantIds: selectedIds,
          reason: reason.trim() ? reason.trim() : undefined,
        }),
      });

      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        throw new Error(j?.message || j?.error || `HTTP ${res.status}`);
      }

      setBulkOpen(false);
      setConfirmText("");
      setReason("");
      setSelected({});
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setWorking(false);
    }
  }

  async function startImpersonation(tenantId: string) {
    setErr(null);
    setImpersonatingTenantId(tenantId);

    try {
      const res = await fetch(`/api/pcc/tenants/${encodeURIComponent(tenantId)}/impersonate`, {
        method: "POST",
        credentials: "include",
      });

      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        throw new Error(j?.message || j?.error || `HTTP ${res.status}`);
      }

      window.location.assign(j?.redirectTo || "/admin");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setImpersonatingTenantId(null);
    }
  }

  React.useEffect(() => {
    setPage(1);
  }, [search, statusFilter, aiFilter]);

  React.useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <div className="space-y-4">
      {selectedCount ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">
              {selectedCount} selected
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className={cn(
                  "rounded-xl border px-3 py-2 text-xs font-semibold",
                  "border-gray-200 bg-white text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-950"
                )}
                onClick={() => setSelected({})}
                disabled={working}
              >
                Clear
              </button>

              <button
                type="button"
                className="rounded-xl bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                onClick={() => {
                  setErr(null);
                  setConfirmText("");
                  setReason("");
                  setBulkOpen(true);
                }}
                disabled={working}
              >
                Archive selected →
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {err ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}

      <div className="rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="border-b border-gray-200 px-5 py-5 dark:border-gray-800">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5 xl:gap-2">
              <button
                type="button"
                onClick={() => setStatusFilter("all")}
                className={cn(
                  "rounded-2xl border px-4 py-3 text-left transition",
                  statusFilter === "all"
                    ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-black"
                    : "border-gray-200 bg-gray-50 text-gray-900 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
                )}
              >
                <div className="text-xs font-semibold uppercase tracking-wide opacity-80">All</div>
                <div className="mt-1 text-lg font-semibold">{rows.length}</div>
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter("active")}
                className={cn(
                  "rounded-2xl border px-4 py-3 text-left transition",
                  statusFilter === "active"
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-gray-200 bg-gray-50 text-gray-900 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
                )}
              >
                <div className="text-xs font-semibold uppercase tracking-wide opacity-80">Active</div>
                <div className="mt-1 text-lg font-semibold">{counts.active}</div>
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter("archived")}
                className={cn(
                  "rounded-2xl border px-4 py-3 text-left transition",
                  statusFilter === "archived"
                    ? "border-amber-600 bg-amber-600 text-white"
                    : "border-gray-200 bg-gray-50 text-gray-900 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
                )}
              >
                <div className="text-xs font-semibold uppercase tracking-wide opacity-80">Archived</div>
                <div className="mt-1 text-lg font-semibold">{counts.archived}</div>
              </button>

              <button
                type="button"
                onClick={() => setAiFilter("needs_confirm")}
                className={cn(
                  "rounded-2xl border px-4 py-3 text-left transition",
                  aiFilter === "needs_confirm"
                    ? "border-amber-600 bg-amber-600 text-white"
                    : "border-gray-200 bg-gray-50 text-gray-900 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
                )}
              >
                <div className="text-xs font-semibold uppercase tracking-wide opacity-80">Needs Confirm</div>
                <div className="mt-1 text-lg font-semibold">{counts.needsConfirm}</div>
              </button>

              <button
                type="button"
                onClick={() => setAiFilter("attention")}
                className={cn(
                  "rounded-2xl border px-4 py-3 text-left transition",
                  aiFilter === "attention"
                    ? "border-red-600 bg-red-600 text-white"
                    : "border-gray-200 bg-gray-50 text-gray-900 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
                )}
              >
                <div className="text-xs font-semibold uppercase tracking-wide opacity-80">Attention</div>
                <div className="mt-1 text-lg font-semibold">{counts.attention}</div>
              </button>
            </div>

            <div className="flex w-full flex-col gap-3 xl:w-[430px]">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, slug, owner, industry, AI status…"
                className="w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-white/5 dark:text-white"
              />

              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setAiFilter("all")}
                  className={cn(
                    "rounded-full border px-3 py-1.5 font-semibold",
                    aiFilter === "all"
                      ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-black"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-200 dark:hover:bg-gray-950"
                  )}
                >
                  All AI states
                </button>
                <button
                  type="button"
                  onClick={() => setAiFilter("ready")}
                  className={cn(
                    "rounded-full border px-3 py-1.5 font-semibold",
                    aiFilter === "ready"
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-200 dark:hover:bg-gray-950"
                  )}
                >
                  AI ready
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
            <div>
              Showing {filteredRows.length === 0 ? 0 : (page - 1) * pageSize + 1}–
              {Math.min(page * pageSize, filteredRows.length)} of {filteredRows.length} tenants
              {!showArchived ? " in active/default view" : ""}
            </div>
            <div>Page {page} of {totalPages}</div>
          </div>
        </div>

        {filteredRows.length ? (
          <div className="divide-y divide-gray-200 dark:divide-gray-800">
            {pagedRows.map((t) => {
              const id = String(t.id);
              const isArchived = String(t.status ?? "").toLowerCase() === "archived";
              const owner = getOwnerLabel(t);
              const plan = normalizePlan(t.planTier ?? "free");
              const limit = getLimitLabel(t);
              const {
                settingsIndustryKey,
                aiKey,
                aiStatus,
                needsConfirm,
                rejectedCount,
                correctness,
                needsAttention,
                graceLeft,
              } = getAiDerived(t);

              const industryLabel =
                safeTrim(t.industryLabel) ||
                safeTrim(settingsIndustryKey) ||
                safeTrim(t.aiSuggestedIndustryLabel) ||
                safeTrim(aiKey) ||
                "Not set";

              const isImpersonatingThisRow = impersonatingTenantId === id;

              return (
                <div
                  key={id}
                  className="px-5 py-5 transition hover:bg-gray-50/70 dark:hover:bg-gray-900/50"
                >
                  <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="flex min-w-0 flex-1 gap-4">
                      <div className="pt-1">
                        <input
                          type="checkbox"
                          checked={Boolean(selected[id])}
                          onChange={(e) => toggleOne(id, e.target.checked)}
                          disabled={isArchived}
                          className="h-4 w-4 rounded border-gray-300 disabled:opacity-50"
                          aria-label={`Select ${t.name ?? "tenant"}`}
                          title={isArchived ? "Archived tenants cannot be selected for bulk archive." : "Select tenant"}
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="truncate text-xl font-semibold text-gray-900 dark:text-gray-100">
                                {t.name ?? "(unnamed)"}
                              </div>
                              <StatusPill status={t.status ?? "active"} archivedAt={t.archivedAt} />
                              {needsAttention ? <SmallPill label="Needs attention" tone="warn" /> : null}
                            </div>

                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
                              <span className="font-mono">{t.slug ?? "—"}</span>
                              <span>•</span>
                              <span>{String(t.id).slice(0, 8)}</span>
                              <span>•</span>
                              <span>Created {fmtDate(t.createdAt)}</span>
                              {isArchived && t.archivedAt ? (
                                <>
                                  <span>•</span>
                                  <span>Archived {fmtDate(t.archivedAt)}</span>
                                </>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {!isArchived ? (
                              <button
                                type="button"
                                onClick={() => startImpersonation(id)}
                                disabled={Boolean(impersonatingTenantId)}
                                className={cn(
                                  "inline-flex items-center rounded-xl border px-4 py-2.5 text-sm font-semibold",
                                  "border-purple-200 bg-purple-50 text-purple-900 hover:bg-purple-100 disabled:opacity-50",
                                  "dark:border-purple-900/40 dark:bg-purple-950/30 dark:text-purple-100 dark:hover:bg-purple-950/50"
                                )}
                              >
                                {isImpersonatingThisRow ? "Impersonating…" : "Impersonate"}
                              </button>
                            ) : null}

                            <Link
                              href={`/pcc/tenants/${encodeURIComponent(id)}`}
                              className={cn(
                                "inline-flex items-center rounded-xl border px-4 py-2.5 text-sm font-semibold",
                                "border-gray-200 bg-white text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-950"
                              )}
                            >
                              View
                            </Link>

                            <Link
                              href={`/pcc/tenants/${encodeURIComponent(id)}/delete`}
                              className={cn(
                                "inline-flex items-center rounded-xl border px-4 py-2.5 text-sm font-semibold",
                                "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/60"
                              )}
                            >
                              {isArchived ? "View archive" : "Archive"}
                            </Link>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 lg:grid-cols-2 2xl:grid-cols-4">
                          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                              Owner
                            </div>
                            <div className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">
                              <span className="font-mono">{owner}</span>
                            </div>
                            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              Current platform-linked owner reference
                            </div>
                          </div>

                          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
                            <div className="flex items-center gap-2">
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                Plan & Credits
                              </div>
                              <PlanPill plan={plan} />
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <SmallPill label={`Limit ${limit}`} tone="neutral" />
                              <SmallPill
                                label={`Grace ${graceLeft}`}
                                tone={graceLeft <= 3 ? "warn" : "neutral"}
                                title="Remaining activation grace credits"
                              />
                            </div>
                            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              Remaining grace before hard enforcement
                            </div>
                          </div>

                          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                              Industry
                            </div>
                            <div className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">
                              {industryLabel}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {settingsIndustryKey ? (
                                <SmallPill label={`set: ${settingsIndustryKey}`} tone="good" />
                              ) : null}
                              {!settingsIndustryKey && aiKey ? (
                                <SmallPill label={`ai: ${aiKey}`} tone="info" />
                              ) : null}
                              {!settingsIndustryKey && !aiKey ? (
                                <SmallPill label="missing industry" tone="warn" />
                              ) : null}
                            </div>
                          </div>

                          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                              AI Signals
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {aiStatus ? (
                                <SmallPill
                                  label={`AI ${aiStatus}`}
                                  tone={
                                    aiStatus === "complete"
                                      ? "good"
                                      : aiStatus === "running"
                                        ? "info"
                                        : aiStatus === "error"
                                          ? "bad"
                                          : aiStatus === "rejected"
                                            ? "warn"
                                            : "neutral"
                                  }
                                />
                              ) : (
                                <SmallPill label="AI idle" tone="neutral" />
                              )}

                              {needsConfirm ? <SmallPill label="needs confirm" tone="warn" /> : null}

                              {correctness === "correct" ? (
                                <SmallPill label="AI match" tone="good" />
                              ) : correctness === "mismatch" ? (
                                <SmallPill label="AI mismatch" tone="bad" />
                              ) : null}

                              {rejectedCount > 0 ? (
                                <SmallPill label={`rejected ${rejectedCount}`} tone="warn" />
                              ) : null}
                            </div>

                            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              {safeTrim(t.aiUpdatedAt)
                                ? `Last AI update: ${fmtDate(t.aiUpdatedAt)}`
                                : "No AI update timestamp"}
                            </div>
                          </div>
                        </div>

                        {needsAttention ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {!settingsIndustryKey && !aiKey ? (
                              <SmallPill label="Missing industry" tone="warn" />
                            ) : null}
                            {needsConfirm ? <SmallPill label="Industry needs confirmation" tone="warn" /> : null}
                            {aiStatus === "error" ? <SmallPill label="AI error" tone="bad" /> : null}
                            {aiStatus === "rejected" ? <SmallPill label="AI rejected" tone="warn" /> : null}
                            {graceLeft <= 3 ? <SmallPill label="Low grace credits" tone="warn" /> : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-5 py-10 text-sm text-gray-600 dark:text-gray-300">
            No tenants match the current filters.
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-950"
          >
            Previous
          </button>

          <div className="text-sm text-gray-500 dark:text-gray-400">
            Page {page} of {totalPages}
          </div>

          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-950"
          >
            Next
          </button>
        </div>
      </div>

      {bulkOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-800 dark:bg-gray-950">
            <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">Archive selected tenants</div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              This will mark the selected tenants as <span className="font-semibold">archived</span>. No data is deleted.
            </div>

            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
              Type <span className="font-mono">{confirmPhrase}</span> to confirm.
            </div>

            {err ? (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                {err}
              </div>
            ) : null}

            <div className="mt-4 space-y-3">
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={confirmPhrase}
                className={cn(
                  "w-full rounded-xl border px-4 py-3 text-sm font-mono",
                  "border-gray-200 bg-white text-gray-900 placeholder:text-gray-400",
                  "dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:placeholder:text-gray-600"
                )}
              />

              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Optional reason (stored in audit log)"
                className={cn(
                  "w-full rounded-xl border px-4 py-3 text-sm",
                  "border-gray-200 bg-white text-gray-900 placeholder:text-gray-400",
                  "dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:placeholder:text-gray-600"
                )}
                rows={3}
              />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                className={cn(
                  "rounded-xl border px-4 py-3 text-sm font-semibold",
                  "border-gray-200 bg-white text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-950"
                )}
                onClick={() => setBulkOpen(false)}
                disabled={working}
              >
                Cancel
              </button>

              <button
                type="button"
                className="rounded-xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                onClick={bulkArchive}
                disabled={!canConfirm || working}
              >
                {working ? "Archiving…" : "Yes, archive"}
              </button>
            </div>

            <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              Archived tenants can be shown via the archived filter. Restore + purge can come later.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}