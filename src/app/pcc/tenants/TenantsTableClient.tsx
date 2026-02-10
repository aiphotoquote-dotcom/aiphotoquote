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

function normalizePlan(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "free";
  if (s === "tier0") return "free";
  if (s === "tier1") return "tier1";
  if (s === "tier2") return "tier2";
  return s;
}

function clamp01(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function pct(n: number) {
  return Math.max(0, Math.min(100, Math.round(clamp01(n) * 100)));
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
};

export default function TenantsTableClient({ rows, showArchived }: { rows: Row[]; showArchived: boolean }) {
  const router = useRouter();

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const selectedIds = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);
  const selectedCount = selectedIds.length;

  const selectableRows = useMemo(() => {
    // Only allow selecting ACTIVE rows (archived rows can still be viewed, not re-archived)
    return rows.filter((r) => String(r.status ?? "active").toLowerCase() !== "archived");
  }, [rows]);

  const allSelectableIds = useMemo(() => selectableRows.map((r) => String(r.id)), [selectableRows]);
  const allChecked = allSelectableIds.length > 0 && allSelectableIds.every((id) => Boolean(selected[id]));
  const someChecked = allSelectableIds.some((id) => Boolean(selected[id])) && !allChecked;

  const [bulkOpen, setBulkOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const confirmPhrase = useMemo(() => `ARCHIVE ${selectedCount} TENANT${selectedCount === 1 ? "" : "S"}`, [selectedCount]);
  const canConfirm = selectedCount > 0 && confirmText.trim() === confirmPhrase;

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

      // Reset UI + refresh server list
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

  return (
    <div className="space-y-3">
      {/* Bulk action bar */}
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

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
        <div className="grid grid-cols-12 gap-0 border-b border-gray-200 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
          <div className="col-span-1 flex items-center">
            <input
              type="checkbox"
              checked={allChecked}
              ref={(el) => {
                if (el) el.indeterminate = someChecked;
              }}
              onChange={toggleAll}
              className="h-4 w-4 rounded border-gray-300"
              aria-label="Select all"
            />
          </div>
          <div className="col-span-3">Tenant</div>
          <div className="col-span-3">Slug</div>
          <div className="col-span-3">Plan / Credits</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        {rows.length ? (
          <div className="divide-y divide-gray-200 dark:divide-gray-800">
            {rows.map((t) => {
              const id = String(t.id);
              const isArchived = String(t.status ?? "").toLowerCase() === "archived";

              const owner = t.ownerUserId
                ? `user:${String(t.ownerUserId).slice(0, 8)}`
                : t.ownerClerkUserId
                ? `clerk:${String(t.ownerClerkUserId).slice(0, 8)}`
                : "—";

              const plan = normalizePlan(t.planTier ?? "free");
              const limit = t.monthlyQuoteLimit === null || t.monthlyQuoteLimit === undefined ? "∞" : String(t.monthlyQuoteLimit);

              const graceTotal = Number(t.activationGraceCredits ?? 0);
              const graceUsed = Number(t.activationGraceUsed ?? 0);
              const graceLeft = Math.max(0, graceTotal - graceUsed);

              return (
                <div key={id} className="grid grid-cols-12 gap-0 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900">
                  <div className="col-span-1 flex items-start pt-1">
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

                  <div className="col-span-3 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="truncate font-semibold text-gray-900 dark:text-gray-100">{t.name ?? "(unnamed)"}</div>
                      <StatusPill status={t.status ?? "active"} archivedAt={t.archivedAt} />
                    </div>
                    <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                      {String(t.id).slice(0, 8)} · {fmtDate(t.createdAt)}
                      {isArchived && t.archivedAt ? ` · archived ${fmtDate(t.archivedAt)}` : ""}
                    </div>
                  </div>

                  <div className="col-span-3 min-w-0 truncate text-sm text-gray-700 dark:text-gray-200">{t.slug ?? "—"}</div>

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
                      href={`/pcc/tenants/${encodeURIComponent(id)}`}
                      className={cn(
                        "inline-flex items-center rounded-lg border px-3 py-2 text-xs font-semibold",
                        "border-gray-200 bg-white text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-950"
                      )}
                    >
                      View
                    </Link>

                    <Link
                      href={`/pcc/tenants/${encodeURIComponent(id)}/delete`}
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

      {/* Bulk confirm modal */}
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
              Archived tenants can be shown via “Show archived”. Restore + purge can come later.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}