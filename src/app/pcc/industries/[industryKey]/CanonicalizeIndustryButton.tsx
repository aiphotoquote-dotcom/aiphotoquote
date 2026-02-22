// src/app/pcc/industries/[industryKey]/CanonicalizeIndustryButton.tsx

"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

export default function CanonicalizeIndustryButton(props: { industryKey: string; defaultLabel?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setErr(null);

    const labelRaw = prompt(`Make "${props.industryKey}" canonical.\n\nLabel (required):`, safeTrim(props.defaultLabel ?? ""));
    const label = safeTrim(labelRaw);
    if (!label) {
      setErr("Label is required.");
      return;
    }

    const description = safeTrim(prompt("Description (optional):") ?? "") || null;
    const reason = safeTrim(prompt("Reason (optional, stored in audit log):") ?? "") || null;

    if (!confirm(`Create an industries row for key "${props.industryKey}" with label "${label}"?`)) return;

    setBusy(true);
    try {
      const r = await fetch("/api/pcc/industries/canonicalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ industryKey: props.industryKey, label, description, reason }),
      });

      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error || data?.message || `HTTP_${r.status}`);

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
        disabled={busy || !props.industryKey}
        className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-950 hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100 dark:hover:bg-emerald-950/50"
        title="Create an industries row for this key (audit logged)"
      >
        {busy ? "Making canonical…" : "Make canonical"}
      </button>

      {err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          <div className="font-semibold">Canonicalize failed</div>
          <div className="mt-1 font-mono break-words">{err}</div>
        </div>
      ) : null}
    </div>
  );
}