// src/app/pcc/industries/[industryKey]/ConfirmIndustryButton.tsx
"use client";

import React, { useState } from "react";

export default function ConfirmIndustryButton(props: {
  tenantId: string;
  industryKey: string;
  onDone?: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function confirm() {
    setErr(null);
    setSaving(true);

    try {
      const res = await fetch(`/api/pcc/tenants/${encodeURIComponent(props.tenantId)}/confirm-industry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ industryKey: props.industryKey }),
      });

      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        throw new Error(String(j?.message || j?.error || `Request failed (HTTP ${res.status})`));
      }

      setOk(true);
      props.onDone?.();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  if (ok) {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
        Confirmed ✓
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={confirm}
        disabled={saving}
        className="rounded-xl bg-black px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
        title="Sets tenant_settings.industry_key and writes tenant_audit_log"
      >
        {saving ? "Confirming…" : "Confirm industry"}
      </button>

      {err ? (
        <div className="max-w-[240px] rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}
    </div>
  );
}