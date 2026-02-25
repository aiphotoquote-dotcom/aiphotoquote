// src/app/pcc/industries/[industryKey]/MergeIndustryButton.tsx

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Option = { key: string; label: string; isCanonical: boolean; tenantCount: number };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

export default function MergeIndustryButton(props: { sourceKey: string }) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<Option[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sourceKey = safeTrim(props.sourceKey).toLowerCase();

  const filtered = useMemo(() => {
    const qq = safeTrim(q).toLowerCase();
    if (!qq) return options;
    return options.filter((o) => o.key.includes(qq) || o.label.toLowerCase().includes(qq));
  }, [options, q]);

  async function loadOptions(query: string) {
    setErr(null);
    setLoading(true);
    try {
      const r = await fetch(`/api/pcc/industries/options?limit=300&q=${encodeURIComponent(query)}`, {
        method: "GET",
        headers: { "content-type": "application/json" },
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error || data?.message || `HTTP_${r.status}`);

      const opts: Option[] = Array.isArray(data?.options) ? data.options : [];
      const cleaned = opts.filter((o) => safeTrim(o.key).toLowerCase() !== sourceKey);

      setOptions(cleaned);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  // Load once on open (default ordering comes from API)
  useEffect(() => {
    if (!open) return;
    loadOptions("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function onSearch() {
    await loadOptions(q);
  }

  async function doMerge() {
    setErr(null);

    const targetKey = safeTrim(selectedKey).toLowerCase();
    if (!targetKey) {
      setErr("Pick a target industry to merge into.");
      return;
    }
    if (targetKey === sourceKey) {
      setErr("Target cannot equal source.");
      return;
    }

    const reason = safeTrim(prompt("Reason (optional, saved to audit log):") ?? "") || null;

    if (
      !confirm(
        `Merge "${sourceKey}" INTO "${targetKey}"?\n\nMoves tenants/sub-industries/packs to the target. If the source has an industries row, it will be hard-deleted.`
      )
    ) {
      return;
    }

    setBusy(true);
    try {
      const r = await fetch("/api/pcc/industries/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceKey,
          targetKey,
          reason,
          deleteSource: true,
        }),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error || data?.message || `HTTP_${r.status}`);

      // ✅ After merge, the source page can be deleted/stale.
      // Navigate away FIRST, then refresh to ensure list is current.
      setOpen(false);
      setSelectedKey("");
      setQ("");

      router.push("/pcc/industries");
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100 dark:hover:bg-amber-950/50"
        title="Merge this industry into another"
      >
        Merge…
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !busy && setOpen(false)} />

          <div className="relative w-full max-w-xl rounded-2xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-800 dark:bg-gray-950">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Merge industry</div>
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                  Source: <span className="font-mono">{sourceKey}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className={cn(
                  "rounded-xl border px-3 py-2 text-xs font-semibold",
                  "border-gray-200 bg-white text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-950",
                  busy && "opacity-60"
                )}
              >
                Close
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search industries… (sorted: canonical then most used)"
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 outline-none dark:border-gray-800 dark:bg-black dark:text-gray-100"
                />
                <button
                  type="button"
                  onClick={onSearch}
                  disabled={loading || busy}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-xs font-semibold",
                    "border-gray-200 bg-white text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-950",
                    (loading || busy) && "opacity-60"
                  )}
                >
                  {loading ? "…" : "Search"}
                </button>
              </div>

              <div className="max-h-[340px] overflow-auto rounded-xl border border-gray-200 dark:border-gray-800">
                {loading ? (
                  <div className="p-3 text-xs text-gray-500 dark:text-gray-400">Loading…</div>
                ) : filtered.length ? (
                  <ul className="divide-y divide-gray-100 dark:divide-gray-900">
                    {filtered.map((o) => {
                      const active = o.key === selectedKey;

                      return (
                        <li key={o.key}>
                          <button
                            type="button"
                            onClick={() => setSelectedKey(o.key)}
                            className={cn(
                              "w-full px-3 py-2 text-left",
                              active ? "bg-gray-100 dark:bg-gray-900/60" : "hover:bg-gray-50 dark:hover:bg-gray-900/30"
                            )}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">{o.label}</div>
                                <div className="mt-0.5 text-[11px] text-gray-600 dark:text-gray-300 truncate">
                                  <span className="font-mono">{o.key}</span>
                                </div>
                              </div>

                              <div className="shrink-0 flex items-center gap-2">
                                <span
                                  className={cn(
                                    "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                                    o.isCanonical
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
                                      : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
                                  )}
                                >
                                  {o.isCanonical ? "canonical" : "derived"}
                                </span>

                                <span
                                  className={cn(
                                    "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                                    "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-200"
                                  )}
                                  title="Tenants currently assigned (tenant_settings.industry_key)"
                                >
                                  tenants: {o.tenantCount}
                                </span>
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="p-3 text-xs text-gray-500 dark:text-gray-400">No matches.</div>
                )}
              </div>

              {err ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                  <div className="font-semibold">Merge failed</div>
                  <div className="mt-1 font-mono break-words">{err}</div>
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-gray-600 dark:text-gray-300">
                  Target: <span className="font-mono">{selectedKey ? selectedKey : "—"}</span>
                </div>

                <button
                  type="button"
                  onClick={doMerge}
                  disabled={busy || !selectedKey}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-xs font-semibold",
                    "border-amber-300 bg-amber-200 text-amber-950 hover:bg-amber-300 dark:border-amber-900/40 dark:bg-amber-900/30 dark:text-amber-100 dark:hover:bg-amber-900/45",
                    (busy || !selectedKey) && "opacity-60"
                  )}
                >
                  {busy ? "Merging…" : "Merge into target"}
                </button>
              </div>

              <div className="text-[11px] text-gray-500 dark:text-gray-400">
                Sorted: canonical first, then highest tenant usage. (Tenant usage = rows in tenant_settings with that industry_key.)
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}