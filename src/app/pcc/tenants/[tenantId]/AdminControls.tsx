// src/app/pcc/tenants/[tenantId]/AdminControls.tsx
"use client";

import React, { useMemo, useState } from "react";

type Props = {
  tenantId: string;
  isArchived: boolean;
  initial: {
    planTier: string;
    monthlyQuoteLimit: number | null;
    activationGraceCredits: number;
    activationGraceUsed: number;
    brandLogoUrl: string | null;
    brandLogoVariant: string | null;
  };
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function toIntOrNull(v: string): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

type PlanTier = "tier0" | "tier1" | "tier2";

function normalizeTier(v: unknown): PlanTier {
  const s = String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (s === "free") return "tier0";
  if (s === "tier0" || s === "tier1" || s === "tier2") return s as PlanTier;
  return "tier0";
}

function tierDefaults(tier: PlanTier): {
  monthlyQuoteLimit: number | null;
  graceCreditsTotal: number;
  graceUsed: number;
} {
  if (tier === "tier0") return { monthlyQuoteLimit: 5, graceCreditsTotal: 0, graceUsed: 0 };
  if (tier === "tier1") return { monthlyQuoteLimit: 50, graceCreditsTotal: 50, graceUsed: 0 };
  // tier2 => unlimited
  return { monthlyQuoteLimit: null, graceCreditsTotal: 0, graceUsed: 0 };
}

export default function AdminControls({ tenantId, isArchived, initial }: Props) {
  const [planTier, setPlanTier] = useState<PlanTier>(normalizeTier(initial.planTier));

  const [monthlyQuoteLimit, setMonthlyQuoteLimit] = useState<string>(
    initial.monthlyQuoteLimit === null ? "" : String(initial.monthlyQuoteLimit)
  );

  const [graceCredits, setGraceCredits] = useState<string>(String(initial.activationGraceCredits ?? 0));
  const [graceUsed, setGraceUsed] = useState<string>(String(initial.activationGraceUsed ?? 0));

  const [saving, setSaving] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const remaining = useMemo(() => {
    const t = Number(graceCredits || 0);
    const u = Number(graceUsed || 0);
    if (!Number.isFinite(t) || !Number.isFinite(u)) return 0;
    return Math.max(0, t - u);
  }, [graceCredits, graceUsed]);

  const limitPretty = useMemo(() => {
    const n = toIntOrNull(monthlyQuoteLimit);
    return n === null ? "Unlimited" : String(n);
  }, [monthlyQuoteLimit]);

  function applyDefaults(next: PlanTier) {
    const d = tierDefaults(next);
    setPlanTier(next);
    setMonthlyQuoteLimit(d.monthlyQuoteLimit === null ? "" : String(d.monthlyQuoteLimit));
    setGraceCredits(String(d.graceCreditsTotal));
    setGraceUsed(String(d.graceUsed));
    setOkMsg(`Applied defaults for ${next}. (Not saved yet)`);
  }

  async function save() {
    setOkMsg(null);
    setErrMsg(null);
    setSaving(true);

    try {
      const body = {
        // ✅ DB standard: tier0/tier1/tier2 only
        planTier: normalizeTier(planTier),

        // null => unlimited
        monthlyQuoteLimit: toIntOrNull(monthlyQuoteLimit),

        // ✅ IMPORTANT: these names MUST match the API route BodySchema
        graceCreditsTotal: Math.max(0, Number(graceCredits || 0)),
        graceUsed: Math.max(0, Number(graceUsed || 0)),
      };

      const res = await fetch(`/api/pcc/tenants/${encodeURIComponent(tenantId)}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        throw new Error(String(j?.message || j?.error || `Request failed (HTTP ${res.status})`));
      }

      setOkMsg("Saved. Refresh to see updated server-rendered values.");
    } catch (e: any) {
      setErrMsg(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Admin controls</div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Adjust plan + limits + grace credits for demos/testing.
          </div>
        </div>
        <div
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
            isArchived
              ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
              : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
          )}
        >
          {isArchived ? "ARCHIVED" : "ACTIVE"}
        </div>
      </div>

      {errMsg ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {errMsg}
        </div>
      ) : null}

      {okMsg ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
          {okMsg}
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Plan tier</div>
          <select
            className={cn(
              "mt-2 w-full rounded-xl border px-3 py-3 text-sm",
              "border-gray-200 bg-white text-gray-900 dark:border-gray-800 dark:bg-black dark:text-gray-100"
            )}
            value={planTier}
            onChange={(e) => setPlanTier(normalizeTier(e.target.value))}
            disabled={saving}
          >
            <option value="tier0">tier0 (Free)</option>
            <option value="tier1">tier1</option>
            <option value="tier2">tier2</option>
          </select>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => applyDefaults("tier0")}
              disabled={saving}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-950"
            >
              Apply tier0 defaults
            </button>
            <button
              type="button"
              onClick={() => applyDefaults("tier1")}
              disabled={saving}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-950"
            >
              Apply tier1 defaults (+50 grace)
            </button>
            <button
              type="button"
              onClick={() => applyDefaults("tier2")}
              disabled={saving}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-950"
            >
              Apply tier2 defaults (Unlimited)
            </button>
          </div>

          <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            “Free” is a friendly alias for <span className="font-mono">tier0</span>. We never store “free” in the DB.
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Monthly quote limit</div>
          <input
            className={cn(
              "mt-2 w-full rounded-xl border px-3 py-3 text-sm font-mono",
              "border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:placeholder:text-gray-600"
            )}
            placeholder="(blank = unlimited)"
            value={monthlyQuoteLimit}
            onChange={(e) => setMonthlyQuoteLimit(e.target.value)}
            disabled={saving}
            inputMode="numeric"
          />
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Effective: <span className="font-mono">{limitPretty}</span>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Grace credits (total)</div>
          <input
            className={cn(
              "mt-2 w-full rounded-xl border px-3 py-3 text-sm font-mono",
              "border-gray-200 bg-white text-gray-900 dark:border-gray-800 dark:bg-black dark:text-gray-100"
            )}
            value={graceCredits}
            onChange={(e) => setGraceCredits(e.target.value)}
            disabled={saving}
            inputMode="numeric"
          />
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Grace used</div>
          <input
            className={cn(
              "mt-2 w-full rounded-xl border px-3 py-3 text-sm font-mono",
              "border-gray-200 bg-white text-gray-900 dark:border-gray-800 dark:bg-black dark:text-gray-100"
            )}
            value={graceUsed}
            onChange={(e) => setGraceUsed(e.target.value)}
            disabled={saving}
            inputMode="numeric"
          />
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Remaining: <span className="font-mono">{remaining}</span>
          </div>
        </div>
      </div>

      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>

        <button
          type="button"
          onClick={() => window.location.reload()}
          disabled={saving}
          className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-900 disabled:opacity-50 dark:border-gray-800 dark:bg-black dark:text-gray-100"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}