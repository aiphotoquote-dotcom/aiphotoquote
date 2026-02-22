// src/app/pcc/industries/[industryKey]/DeleteIndustryButton.tsx
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

export default function DeleteIndustryButton(props: { industryKey: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const industryKey = safeLower(props.industryKey);

  async function run() {
    setErr(null);

    const confirmText = safeTrim(prompt(`Type DELETE to delete "${industryKey}" (removes industry + all artifacts).`) ?? "");
    if (confirmText !== "DELETE") return;

    const reason = safeTrim(prompt("Reason (optional, stored in audit log):") ?? "") || null;

    setBusy(true);
    try {
      const r = await fetch("/api/pcc/industries/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ industryKey, reason }),
      });

      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error || data?.message || `HTTP_${r.status}`);

      router.push("/pcc/industries");
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
        disabled={busy || !industryKey}
        className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-900 hover:bg-red-100 disabled:opacity-60 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200 dark:hover:bg-red-950/60"
        title='Delete this industry key and purge artifacts. Blocked if any tenants are assigned. Also scrubs onboarding AI signals so it disappears from the derived list immediately.'
      >
        {busy ? "Deleting…" : "Delete"}
      </button>

      {err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          <div className="font-semibold">Delete failed</div>
          <div className="mt-1 font-mono break-words">{err}</div>
        </div>
      ) : null}
    </div>
  );
}