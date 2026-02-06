"use client";

import React, { useMemo, useState } from "react";

type PlanTier = "tier0" | "tier1" | "tier2";

function tierLabel(t: PlanTier) {
  if (t === "tier0") return "Tier 0";
  if (t === "tier1") return "Tier 1";
  return "Tier 2";
}

function tierSubtitle(t: PlanTier) {
  if (t === "tier0") return "Get started free (limited)";
  if (t === "tier1") return "For small teams";
  return "For growing teams";
}

function tierDetails(t: PlanTier) {
  if (t === "tier0") {
    return [
      "5 quotes / month",
      "Uses platform AI keys",
      "Single user (owner)",
      "Upgrade anytime",
    ];
  }
  if (t === "tier1") {
    return [
      "50 quotes / month",
      "Multiple users",
      "Requires tenant OpenAI key to go live",
      "Includes 30 grace credits while you add your key",
    ];
  }
  return [
    "Unlimited quotes",
    "Multiple users",
    "Requires tenant OpenAI key to go live",
    "Includes 30 grace credits while you add your key",
  ];
}

export function Step6Plan(props: {
  tenantId: string | null;
  currentPlan: PlanTier | null;
  onBack: () => void;
  onSaved: (p: PlanTier) => void;
  openWidgetSetup: () => void;
}) {
  const [selected, setSelected] = useState<PlanTier>(props.currentPlan ?? "tier0");
  const [saving, setSaving] = useState(false);
  const [savedPlan, setSavedPlan] = useState<PlanTier | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const tid = String(props.tenantId ?? "").trim();

  const canSave = Boolean(tid) && !saving;

  const cards: PlanTier[] = useMemo(() => ["tier0", "tier1", "tier2"], []);

  async function savePlan() {
    setErr(null);

    if (!tid) {
      setErr("NO_TENANT: missing tenantId.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/onboarding/state", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          step: 6,
          tenantId: tid,
          plan: selected,
        }),
      });

      const j = await res.json().catch(() => null);

      if (!res.ok || !j?.ok) {
        const msg = String(j?.message || j?.error || "").trim();
        throw new Error(msg || `Request failed (HTTP ${res.status})`);
      }

      setSavedPlan(selected);
      props.onSaved(selected);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  const done = Boolean(savedPlan);

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">Choose your plan</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        Pick what fits today. You can change this later.
      </div>

      {err ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}

      {done ? (
        <div className="mt-6 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900/40 dark:bg-emerald-950/30">
          <div className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">You’re live ✅</div>
          <div className="mt-1 text-sm text-emerald-900/90 dark:text-emerald-100/90">
            Plan saved: <span className="font-mono">{savedPlan}</span>. Next: set up your widget so customers can submit
            photos from your website.
          </div>

          <div className="mt-4 grid gap-3">
            <button
              type="button"
              className="w-full rounded-2xl bg-emerald-600 py-3 text-sm font-semibold text-white"
              onClick={props.openWidgetSetup}
            >
              Open Widget setup
            </button>

            <button
              type="button"
              className="w-full rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              onClick={props.onBack}
            >
              Back
            </button>
          </div>

          <div className="mt-3 text-xs text-emerald-950/70 dark:text-emerald-100/70">
            Tip: after widget setup, run a test quote to confirm emails + AI estimate flow.
          </div>
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-3">
            {cards.map((t) => {
              const active = selected === t;
              return (
                <button
                  key={t}
                  type="button"
                  className={[
                    "text-left rounded-3xl border p-4 transition",
                    active
                      ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-black"
                      : "border-gray-200 bg-white text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100",
                  ].join(" ")}
                  onClick={() => setSelected(t)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{tierLabel(t)}</div>
                      <div className={active ? "text-sm opacity-90" : "text-sm text-gray-600 dark:text-gray-300"}>
                        {tierSubtitle(t)}
                      </div>
                    </div>
                    <div className="shrink-0 text-xs font-mono">{t}</div>
                  </div>

                  <ul className="mt-3 list-disc pl-5 text-sm">
                    {tierDetails(t).map((d) => (
                      <li key={d} className={active ? "opacity-95" : "text-gray-700 dark:text-gray-200"}>
                        {d}
                      </li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              className="rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              onClick={props.onBack}
              disabled={saving}
            >
              Back
            </button>

            <button
              type="button"
              className="rounded-2xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
              onClick={savePlan}
              disabled={!canSave}
            >
              {saving ? "Saving…" : "Save & Finish"}
            </button>
          </div>

          <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            Note: Tier 1–2 will prompt you to add your OpenAI key during setup (we’ll handle that next).
          </div>
        </>
      )}
    </div>
  );
}