// src/app/pcc/industries/[industryKey]/AddDefaultSubIndustryButton.tsx
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

function isReasonableKey(k: string) {
  // snake_case-ish (same rule you used for industry_key)
  return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(k);
}

async function postJson(url: string, body: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    credentials: "include",
    body: JSON.stringify(body ?? {}),
  });

  const txt = await res.text().catch(() => "");
  let j: any = null;
  try {
    j = txt ? JSON.parse(txt) : null;
  } catch {
    j = null;
  }

  if (!res.ok || !j?.ok) {
    throw new Error(String(j?.message || j?.error || (txt ? txt : `Request failed (HTTP ${res.status})`)));
  }
  return j;
}

export default function AddDefaultSubIndustryButton(props: { industryKey: string }) {
  const router = useRouter();

  const industryKey = safeTrim(props.industryKey);

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState("0");

  const normalizedKey = useMemo(() => safeTrim(key).toLowerCase(), [key]);
  const normalizedLabel = useMemo(() => safeTrim(label), [label]);
  const normalizedDescription = useMemo(() => {
    const d = safeTrim(description);
    return d ? d : "";
  }, [description]);

  const sortOrderNum = useMemo(() => {
    const s = safeTrim(sortOrder);
    const n = Number(s);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }, [sortOrder]);

  const canSave = useMemo(() => {
    if (!industryKey) return false;
    if (!normalizedKey || !isReasonableKey(normalizedKey)) return false;
    if (!normalizedLabel) return false;
    return true;
  }, [industryKey, normalizedKey, normalizedLabel]);

  function resetForm() {
    setKey("");
    setLabel("");
    setDescription("");
    setSortOrder("0");
  }

  async function save() {
    if (!canSave) return;

    setSaving(true);
    setErr(null);
    try {
      await postJson(`/api/pcc/industries/${encodeURIComponent(industryKey)}/sub-industries/add`, {
        key: normalizedKey,
        label: normalizedLabel,
        description: normalizedDescription ? normalizedDescription : null,
        sortOrder: sortOrderNum,
      });

      setOpen(false);
      resetForm();
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => {
          setErr(null);
          setOpen(true);
        }}
        disabled={!industryKey}
        className="rounded-xl bg-black px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
        title="Platform owner only (API enforced). Adds / re-activates a default sub-industry for this industry."
      >
        Add default
      </button>

      {err && !open ? (
        <div className="max-w-[360px] rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-800 dark:bg-gray-950">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">Add default sub-industry</div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Industry: <span className="font-mono">{industryKey}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (saving) return;
                  setOpen(false);
                  setErr(null);
                }}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-200 dark:hover:bg-gray-950"
              >
                Close
              </button>
            </div>

            {err ? (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                {err}
              </div>
            ) : null}

            <div className="mt-4 space-y-3">
              <div>
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Key (snake_case)</div>
                <input
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="auto_glass_repair"
                  className={cn(
                    "mt-1 w-full rounded-xl border px-4 py-3 text-sm font-mono",
                    "border-gray-200 bg-white text-gray-900 placeholder:text-gray-400",
                    "dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:placeholder:text-gray-600"
                  )}
                />
                {normalizedKey && !isReasonableKey(normalizedKey) ? (
                  <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-200">
                    Invalid format. Use lowercase snake_case: letters/numbers/underscores.
                  </div>
                ) : null}
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Label</div>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Auto Glass Repair"
                  className={cn(
                    "mt-1 w-full rounded-xl border px-4 py-3 text-sm",
                    "border-gray-200 bg-white text-gray-900 placeholder:text-gray-400",
                    "dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:placeholder:text-gray-600"
                  )}
                />
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Description (optional)</div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Short description shown in defaults list."
                  rows={3}
                  className={cn(
                    "mt-1 w-full rounded-xl border px-4 py-3 text-sm",
                    "border-gray-200 bg-white text-gray-900 placeholder:text-gray-400",
                    "dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:placeholder:text-gray-600"
                  )}
                />
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Sort order</div>
                <input
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                  inputMode="numeric"
                  placeholder="0"
                  className={cn(
                    "mt-1 w-full rounded-xl border px-4 py-3 text-sm font-mono",
                    "border-gray-200 bg-white text-gray-900 placeholder:text-gray-400",
                    "dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:placeholder:text-gray-600"
                  )}
                />
                <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Lower numbers appear first.</div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                className={cn(
                  "rounded-xl border px-4 py-3 text-sm font-semibold",
                  "border-gray-200 bg-white text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-950"
                )}
                onClick={() => {
                  if (saving) return;
                  setOpen(false);
                  setErr(null);
                }}
                disabled={saving}
              >
                Cancel
              </button>

              <button
                type="button"
                className="rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-black"
                onClick={save}
                disabled={!canSave || saving}
                title={!canSave ? "Enter a valid key + label" : "Create / update default sub-industry"}
              >
                {saving ? "Saving…" : "Save default"}
              </button>
            </div>

            <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              API is owner-only. If you aren’t an owner, you’ll get a 403 from the server.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}