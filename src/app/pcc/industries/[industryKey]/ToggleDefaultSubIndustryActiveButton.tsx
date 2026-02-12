// src/app/pcc/industries/[industryKey]/ToggleDefaultSubIndustryActiveButton.tsx

"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
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

export default function ToggleDefaultSubIndustryActiveButton(props: {
  industryKey: string;
  subKey: string;
  subLabel?: string | null;
  isActive: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const label = useMemo(() => safeTrim(props.subLabel) || safeTrim(props.subKey), [props.subLabel, props.subKey]);

  async function toggle() {
    const industryKey = safeTrim(props.industryKey);
    const subKey = safeTrim(props.subKey);
    if (!industryKey || !subKey) return;

    const nextActive = !props.isActive;
    const verb = nextActive ? "reactivate" : "deactivate";

    const ok = window.confirm(`Confirm: ${verb} "${label}"?`);
    if (!ok) return;

    setErr(null);
    setSaving(true);
    try {
      await postJson(`/api/pcc/industries/${encodeURIComponent(industryKey)}/sub-industries/toggle-active`, {
        key: subKey,
        isActive: nextActive,
      });
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
        onClick={toggle}
        disabled={saving}
        className={
          "rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-50 " +
          (props.isActive
            ? "border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
            : "border border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100")
        }
        title="Platform owner only (API enforced). No deletes — just toggles active state."
      >
        {saving ? "Saving…" : props.isActive ? "Deactivate" : "Reactivate"}
      </button>

      {err ? (
        <div className="max-w-[320px] rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}
    </div>
  );
}