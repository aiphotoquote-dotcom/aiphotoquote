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

async function isCanonicalIndustry(industryKeyLower: string): Promise<boolean> {
  // Best-effort check: if this page can load it already knows,
  // but we only received industryKey here. So we probe the list route.
  // If you already have a better canonical-check endpoint, swap this.
  try {
    const r = await fetch(`/api/pcc/industries/exists?industryKey=${encodeURIComponent(industryKeyLower)}`, {
      method: "GET",
      cache: "no-store",
    });
    const data = await r.json().catch(() => null);
    return Boolean(data?.ok && data?.isCanonical);
  } catch {
    return false;
  }
}

export default function DeleteIndustryButton(props: { industryKey: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const industryKey = safeLower(props.industryKey);

  async function run() {
    setErr(null);
    if (!industryKey) return;

    setBusy(true);
    try {
      // Determine canonical vs derived
      // If this probe fails, we assume derived (safer: doesn't hard-delete industries row).
      const canonical = await isCanonicalIndustry(industryKey);

      // Confirm text differs by type
      const confirmPrompt = canonical
        ? `Type DELETE to permanently delete canonical industry "${industryKey}" (hard delete).`
        : `Type DELETE to delete PCC artifacts for derived industry "${industryKey}". (It can reappear later.)`;

      setBusy(false); // release for prompt UX
      const confirmText = safeTrim(prompt(confirmPrompt) ?? "");
      if (confirmText !== "DELETE") return;

      const reason = safeTrim(prompt("Reason (optional, stored in audit log):") ?? "") || null;

      setBusy(true);

      const url = canonical ? "/api/pcc/industries/delete" : "/api/pcc/industries/delete-derived";

      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ industryKey, reason }),
      });

      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error || data?.message || `HTTP_${r.status}`);

      // Canonical delete will make the page 404. Derived delete should keep page alive
      // but UI will be cleaner if we return to list either way.
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
        title='Delete industry. Canonical: hard delete (blocked if tenants assigned). Derived: deletes PCC artifacts only; may reappear later.'
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