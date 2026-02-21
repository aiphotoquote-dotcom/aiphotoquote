// src/app/pcc/industries/[industryKey]/MergeIndustryButton.tsx

"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function safeLower(v: unknown) {
  return safeTrim(v).toLowerCase();
}

export default function MergeIndustryButton(props: { sourceKey: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sourceKey = safeLower(props.sourceKey);

  async function run() {
    setErr(null);

    const targetKeyRaw = prompt(`Merge "${sourceKey}" into which TARGET industry key? (type the target key)`);
    const targetKey = safeLower(targetKeyRaw);
    if (!targetKey) return;

    if (targetKey === sourceKey) {
      setErr("Target cannot equal source.");
      return;
    }

    const reason = safeTrim(prompt("Reason (optional, stored in audit log):") ?? "") || null;

    if (!confirm(`This will MOVE all tenants/sub-industries/packs from "${sourceKey}" → "${targetKey}" then HARD DELETE "${sourceKey}". Continue?`)) {
      return;
    }

    setBusy(true);
    try {
      const r = await fetch("/api/pcc/industries/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceKey, targetKey, reason, deleteSource: true }),
      });

      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error || data?.message || `HTTP_${r.status}`);

      // refresh the page data
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={run}
        disabled={busy || !sourceKey}
        className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-60 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100 dark:hover:bg-amber-950/50"
        title="Move everything to target, then hard-delete source (audit logged)"
      >
        {busy ? "Merging…" : "Merge…"}
      </button>

      {err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          <div className="font-semibold">Merge failed</div>
          <div className="mt-1 font-mono break-words">{err}</div>
        </div>
      ) : null}
    </div>
  );
}