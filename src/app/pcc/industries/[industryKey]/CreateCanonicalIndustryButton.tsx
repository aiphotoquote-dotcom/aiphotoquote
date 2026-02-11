"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function isReasonableIndustryKey(k: string) {
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

export default function CreateCanonicalIndustryButton(props: {
  industryKey: string;
  defaultLabel?: string | null;
  defaultDescription?: string | null;
  onDone?: () => void;
}) {
  const router = useRouter();

  const key = safeTrim(props.industryKey);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const canAct = useMemo(() => Boolean(key && isReasonableIndustryKey(key)), [key]);

  async function create() {
    if (!canAct) return;

    const label = safeTrim(
      window.prompt(
        `Create canonical industry row?\n\nKey: ${key}\n\nEnter label:`,
        safeTrim(props.defaultLabel) || key
      )
    );

    if (!label) return;

    const description = safeTrim(
      window.prompt(`Optional description for "${label}" (can be empty):`, safeTrim(props.defaultDescription) || "")
    );

    setErr(null);
    setSaving(true);

    try {
      await postJson("/api/pcc/industries/create", {
        key,
        label,
        description: description || null,
      });

      setOk(true);
      router.refresh();
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
        Canonical ✓
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={create}
        disabled={!canAct || saving}
        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-[11px] font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-950"
        title="Creates/updates industries row for this key (platform_owner only)"
      >
        {saving ? "Creating…" : "Create canonical"}
      </button>

      {err ? (
        <div className="max-w-[280px] rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}
    </div>
  );
}