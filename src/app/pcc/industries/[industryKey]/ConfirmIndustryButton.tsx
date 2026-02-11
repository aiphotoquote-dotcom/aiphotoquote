// src/app/pcc/industries/[industryKey]/ConfirmIndustryButton.tsx
"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function isReasonableIndustryKey(k: string) {
  // allow snake_case keys like roofing_services, collision_repair, etc.
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

export default function ConfirmIndustryButton(props: {
  tenantId: string;
  industryKey: string;

  // optional UI hooks
  tenantName?: string;
  onDone?: () => void;
}) {
  const router = useRouter();

  const tenantId = safeTrim(props.tenantId);
  const suggestedKey = safeTrim(props.industryKey);

  const canAct = Boolean(tenantId && suggestedKey);

  const [saving, setSaving] = useState<"confirm" | "reject" | "reassign" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<null | "confirmed" | "rejected" | "reassigned">(null);

  async function confirm() {
    if (!canAct || saving) return;

    setErr(null);
    setSaving("confirm");

    try {
      await postJson(`/api/pcc/tenants/${encodeURIComponent(tenantId)}/confirm-industry`, {
        industryKey: suggestedKey,
      });

      setOk("confirmed");
      router.refresh();
      props.onDone?.();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(null);
    }
  }

  async function reject() {
    if (!canAct || saving) return;

    const label = props.tenantName ? ` for ${props.tenantName}` : "";
    const yn = window.confirm(
      `Reject AI suggestion${label}?\n\nThis will mark this industry key as rejected for this tenant so it won’t keep showing as a suggested match.`
    );
    if (!yn) return;

    setErr(null);
    setSaving("reject");

    try {
      await postJson(`/api/pcc/tenants/${encodeURIComponent(tenantId)}/reject-industry`, {
        industryKey: suggestedKey,
      });

      setOk("rejected");
      router.refresh();
      props.onDone?.();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(null);
    }
  }

  async function reassign() {
    if (!tenantId || saving) return;

    const current = suggestedKey || "";
    const next = safeTrim(
      window.prompt(
        `Reassign tenant to a different industry key.\n\nCurrent suggested key: ${current}\n\nEnter new industry_key (snake_case):`,
        current
      )
    ).toLowerCase();

    if (!next) return;

    if (!isReasonableIndustryKey(next)) {
      setErr("Invalid industry key format. Use snake_case like: roofing_services");
      return;
    }

    setErr(null);
    setSaving("reassign");

    try {
      await postJson(`/api/pcc/tenants/${encodeURIComponent(tenantId)}/set-industry`, {
        industryKey: next,
        // helpful context for audit/debug on server
        source: "pcc_reassign",
        previousSuggestedIndustryKey: current || null,
      });

      setOk("reassigned");
      router.refresh();
      props.onDone?.();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(null);
    }
  }

  // Compact state chips after action
  if (ok === "confirmed") {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
        Confirmed ✓
      </span>
    );
  }
  if (ok === "rejected") {
    return (
      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
        Rejected ✓
      </span>
    );
  }
  if (ok === "reassigned") {
    return (
      <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-100">
        Reassigned ✓
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={confirm}
          disabled={!canAct || saving !== null}
          className="rounded-xl bg-black px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
          title="Confirm this industry for the tenant (writes tenant_settings.industry_key)"
        >
          {saving === "confirm" ? "Confirming…" : "Confirm"}
        </button>

        <button
          type="button"
          onClick={reassign}
          disabled={!tenantId || saving !== null}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-[11px] font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
          title="Assign a different industry key to this tenant"
        >
          {saving === "reassign" ? "Saving…" : "Reassign"}
        </button>

        <button
          type="button"
          onClick={reject}
          disabled={!canAct || saving !== null}
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-900 hover:bg-red-100 disabled:opacity-50 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200 dark:hover:bg-red-950/60"
          title="Reject this AI suggestion for the tenant"
        >
          {saving === "reject" ? "Rejecting…" : "Reject"}
        </button>
      </div>

      {err ? (
        <div className="max-w-[280px] rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}
    </div>
  );
}