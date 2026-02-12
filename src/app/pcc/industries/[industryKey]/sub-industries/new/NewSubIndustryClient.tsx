// src/app/pcc/industries/[industryKey]/sub-industries/new/NewSubIndustryClient.tsx
"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function normalizeKey(v: string) {
  // keep it strict and predictable for joins
  // lower, underscores, alnum only
  return safeTrim(v)
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export default function NewSubIndustryClient({ industryKey }: { industryKey: string }) {
  const router = useRouter();

  const [subKeyRaw, setSubKeyRaw] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState<string>("100");

  const [working, setWorking] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const subKey = useMemo(() => normalizeKey(subKeyRaw), [subKeyRaw]);

  const canSubmit = useMemo(() => {
    if (!industryKey) return false;
    if (!subKey) return false;
    if (!safeTrim(label)) return false;
    const so = Number(sortOrder);
    if (!Number.isFinite(so) || so < 0 || so > 100000) return false;
    return true;
  }, [industryKey, subKey, label, sortOrder]);

  async function submit() {
    if (!canSubmit || working) return;

    setWorking(true);
    setErr(null);
    setOkMsg(null);

    try {
      const res = await fetch(`/api/pcc/industries/${encodeURIComponent(industryKey)}/sub-industries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          key: subKey,
          label: safeTrim(label),
          description: safeTrim(description) || undefined,
          sortOrder: Number(sortOrder),
        }),
      });

      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        throw new Error(j?.message || j?.error || `HTTP ${res.status}`);
      }

      setOkMsg("Saved. Returning to industry…");
      router.push(`/pcc/industries/${encodeURIComponent(industryKey)}`);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Default sub-industry details</div>
        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Key should be stable. Example: <span className="font-mono">auto_upholstery</span>,{" "}
          <span className="font-mono">marine_canvas</span>, <span className="font-mono">paving_residential</span>.
        </div>
      </div>

      {err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}

      {okMsg ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
          {okMsg}
        </div>
      ) : null}

      <div className="grid gap-3">
        <label className="grid gap-1">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Sub-industry key *</div>
          <input
            value={subKeyRaw}
            onChange={(e) => setSubKeyRaw(e.target.value)}
            placeholder="e.g. marine_canvas"
            className={cn(
              "w-full rounded-xl border px-4 py-3 text-sm font-mono",
              "border-gray-200 bg-white text-gray-900 placeholder:text-gray-400",
              "dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:placeholder:text-gray-600"
            )}
            autoComplete="off"
            spellCheck={false}
          />
          {subKeyRaw && subKeyRaw !== subKey ? (
            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              Normalized to: <span className="font-mono">{subKey}</span>
            </div>
          ) : null}
        </label>

        <label className="grid gap-1">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Label *</div>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Marine Canvas & Covers"
            className={cn(
              "w-full rounded-xl border px-4 py-3 text-sm",
              "border-gray-200 bg-white text-gray-900 placeholder:text-gray-400",
              "dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:placeholder:text-gray-600"
            )}
            autoComplete="off"
          />
        </label>

        <label className="grid gap-1">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Description</div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional. What types of work fit this sub-industry?"
            className={cn(
              "w-full rounded-xl border px-4 py-3 text-sm",
              "border-gray-200 bg-white text-gray-900 placeholder:text-gray-400",
              "dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:placeholder:text-gray-600"
            )}
            rows={3}
          />
        </label>

        <label className="grid gap-1">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Sort order *</div>
          <input
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            placeholder="100"
            className={cn(
              "w-full rounded-xl border px-4 py-3 text-sm font-mono",
              "border-gray-200 bg-white text-gray-900 placeholder:text-gray-400",
              "dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:placeholder:text-gray-600"
            )}
            inputMode="numeric"
          />
          <div className="text-[11px] text-gray-500 dark:text-gray-400">Lower numbers appear first. Typical defaults: 10, 20, 30…</div>
        </label>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          className={cn(
            "rounded-xl border px-4 py-3 text-sm font-semibold",
            "border-gray-200 bg-white text-gray-900 hover:bg-gray-50",
            "dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-950"
          )}
          onClick={() => router.push(`/pcc/industries/${encodeURIComponent(industryKey)}`)}
          disabled={working}
        >
          Cancel
        </button>

        <button
          type="button"
          className="rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          onClick={submit}
          disabled={!canSubmit || working}
          title={!canSubmit ? "Fill required fields and valid sort order" : "Save default sub-industry"}
        >
          {working ? "Saving…" : "Save default"}
        </button>
      </div>

      <div className="pt-2 text-xs text-gray-500 dark:text-gray-400">
        Next step: implement the POST API route + audit log entry.
      </div>
    </div>
  );
}