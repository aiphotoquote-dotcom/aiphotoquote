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

export default function DeleteIndustryButton(props: {
  industryKey: string;
  mode: "canonical" | "derived";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const industryKey = safeLower(props.industryKey);

  const endpoint =
    props.mode === "canonical"
      ? "/api/pcc/industries/delete"
      : "/api/pcc/industries/delete-derived";

  async function run() {
    setErr(null);

    const confirmWord = props.mode === "canonical" ? "DELETE" : "DELETE_DERIVED";
    const confirmText = safeTrim(
      prompt(
        `Type ${confirmWord} to permanently delete "${industryKey}" (${
          props.mode === "canonical"
            ? "removes industries row + all artifacts"
            : "removes artifacts only (no industries row)"
        }).`
      ) ?? ""
    );

    if (confirmText !== confirmWord) return;

    const reason =
      safeTrim(prompt("Reason (optional, stored in audit log):") ?? "") || null;

    setBusy(true);
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ industryKey, reason }),
      });

      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error || data?.message || `HTTP_${r.status}`);

      // Canonical delete: the detail page will 404; return to list.
      // Derived delete: same behavior is fine (it’s gone from DB artifacts).
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
        title={
          props.mode === "canonical"
            ? "Hard delete canonical industry (blocked if any tenants assigned). Audit logged."
            : "Delete derived artifacts for this key (blocked if any tenants assigned). Audit logged."
        }
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