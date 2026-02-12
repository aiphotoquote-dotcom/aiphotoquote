"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function isReasonableKey(k: string) {
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
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    const industryKey = safeTrim(props.industryKey);
    if (!industryKey) return;

    const key = safeTrim(window.prompt("Sub-industry key (snake_case):", ""));
    if (!key) return;
    const subKey = key.toLowerCase();
    if (!isReasonableKey(subKey)) {
      setErr("Invalid key format. Use snake_case like: auto_glass_repair");
      return;
    }

    const label = safeTrim(window.prompt("Label:", ""));
    if (!label) return;

    const sortOrderRaw = safeTrim(window.prompt("Sort order (optional number):", "0"));
    const sortOrder = sortOrderRaw ? Number(sortOrderRaw) : 0;

    setErr(null);
    setSaving(true);
    try {
      await postJson(
        `/api/pcc/industries/${encodeURIComponent(industryKey)}/sub-industries/add`,
        { key: subKey, label, sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0 }
      );
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
        onClick={add}
        disabled={saving}
        className="rounded-xl bg-black px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
        title="Platform owner only (API enforced). Adds / re-activates a default sub-industry for this industry."
      >
        {saving ? "Adding…" : "Add default"}
      </button>

      {err ? (
        <div className="max-w-[320px] rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}
    </div>
  );
}