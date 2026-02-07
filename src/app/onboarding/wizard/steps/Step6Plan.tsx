// src/app/onboarding/wizard/steps/Step6Plan.tsx
"use client";

import React, { useMemo, useState } from "react";

type PlanTier = "tier0" | "tier1" | "tier2";

function safePlan(v: any): PlanTier | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "tier0" || s === "free") return "tier0";
  if (s === "tier1") return "tier1";
  if (s === "tier2") return "tier2";
  return null;
}

function tierLabel(t: PlanTier) {
  if (t === "tier0") return "Starter";
  if (t === "tier1") return "Pro";
  return "Unlimited";
}

function tierSubtitle(t: PlanTier) {
  if (t === "tier0") return "Try AI quoting for free";
  if (t === "tier1") return "For small teams shipping fast";
  return "Maximize your workflow";
}

function tierPrice(t: PlanTier) {
  // Fake pricing for now (UI polish only; no billing implied)
  if (t === "tier0") return { amount: "$0", suffix: "/ mo", note: "No card required" };
  if (t === "tier1") return { amount: "$49", suffix: "/ mo", note: "Best for most shops" };
  return { amount: "$99", suffix: "/ mo", note: "For growing teams" };
}

function tierDetails(t: PlanTier) {
  if (t === "tier0") {
    return ["5 quotes / month", "Uses platform AI keys", "Single user (owner)", "Upgrade anytime"];
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

function tierIcon(t: PlanTier) {
  if (t === "tier0") return "🧰";
  if (t === "tier1") return "⚡️";
  return "👑";
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

      const serverPlan = safePlan(j?.planTier) ?? selected;

      setSavedPlan(serverPlan);
      props.onSaved(serverPlan);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  const done = Boolean(savedPlan);
  const needsKey = savedPlan === "tier1" || savedPlan === "tier2";

  return (
    <div>
      {/* Hero header (mobile-first, light/dark safe) */}
      <div className="text-center">
        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Step 6 of 6</div>
        <div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
          How much AI do you want working for you?
        </div>
        <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          Select the plan that fits your business today. You can change this anytime.
        </div>
      </div>

      {err ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}

      {done ? (
        <div className="mt-6 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900/40 dark:bg-emerald-950/30">
          <div className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">Plan saved ✅</div>
          <div className="mt-1 text-sm text-emerald-900/90 dark:text-emerald-100/90">
            Selected: <span className="font-mono">{savedPlan}</span>.
            {needsKey ? (
              <> Next: add your OpenAI key to activate Tier 1–2, then set up your widget.</>
            ) : (
              <> Next: set up your widget so customers can submit photos from your website.</>
            )}
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
          {/* Subtle “atmosphere” shell */}
          <div className="mt-6 rounded-3xl border border-gray-200 bg-gradient-to-b from-gray-50 to-white p-3 dark:border-gray-800 dark:from-gray-900 dark:to-gray-950">
            <div className="grid gap-3">
              {cards.map((t) => {
                const active = selected === t;
                const price = tierPrice(t);
                const popular = t === "tier1";

                const cls = [
                  "relative text-left rounded-3xl border p-4 transition",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                  "focus-visible:ring-gray-900 dark:focus-visible:ring-white",
                  "focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-950",
                  active
                    ? "border-gray-900 bg-gray-900 text-white shadow-lg dark:border-white dark:bg-white dark:text-black"
                    : popular
                      ? "border-emerald-400/60 bg-white shadow-lg dark:border-emerald-500/40 dark:bg-gray-950"
                      : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950",
                  // subtle “glow” for Pro even when not selected (keeps it premium on both themes)
                  !active && popular ? "ring-1 ring-emerald-400/25 dark:ring-emerald-500/20" : "",
                ].join(" ");

                return (
                  <button key={t} type="button" className={cls} onClick={() => setSelected(t)}>
                    {/* Most popular badge */}
                    {popular ? (
                      <div className="mb-3 inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200">
                        Most popular
                      </div>
                    ) : (
                      <div className="mb-3 h-[26px]" />
                    )}

                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-base">{tierIcon(t)}</span>
                          <div className="text-base font-semibold">{tierLabel(t)}</div>
                        </div>

                        <div className={active ? "mt-1 text-sm opacity-90" : "mt-1 text-sm text-gray-600 dark:text-gray-300"}>
                          {tierSubtitle(t)}
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <div className="text-xl font-semibold">
                          {price.amount} <span className="text-sm font-medium opacity-90">{price.suffix}</span>
                        </div>
                        <div className={active ? "mt-1 text-xs opacity-85" : "mt-1 text-xs text-gray-500 dark:text-gray-400"}>
                          {price.note}
                        </div>
                      </div>
                    </div>

                    <ul className="mt-4 space-y-2 text-sm">
                      {tierDetails(t).map((d) => (
                        <li key={d} className="flex items-start gap-2">
                          <span className={active ? "mt-[2px] text-white/90 dark:text-black/90" : "mt-[2px] text-emerald-600 dark:text-emerald-400"}>
                            ✓
                          </span>
                          <span className={active ? "opacity-95" : "text-gray-700 dark:text-gray-200"}>{d}</span>
                        </li>
                      ))}
                    </ul>

                    {/* Card footer / selection affordance */}
                    <div className="mt-4 flex items-center justify-between">
                      <div className="text-xs font-mono opacity-70">{t}</div>

                      <div
                        className={[
                          "rounded-xl px-4 py-2 text-center text-sm font-semibold",
                          active
                            ? "bg-white/10 text-white dark:bg-black/10 dark:text-black"
                            : popular
                              ? "bg-emerald-600 text-white"
                              : "border border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-200",
                        ].join(" ")}
                      >
                        {active ? "Selected" : "Select plan"}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Trust points (subtle) */}
          <div className="mt-4 grid gap-2 text-sm text-gray-600 dark:text-gray-300">
            <div className="flex items-start gap-2">
              <span className="mt-[2px] text-emerald-600 dark:text-emerald-400">✓</span>
              <span>Change plans anytime</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="mt-[2px] text-emerald-600 dark:text-emerald-400">✓</span>
              <span>No customer pricing shown in your quotes</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="mt-[2px] text-emerald-600 dark:text-emerald-400">✓</span>
              <span>Manual review always possible</span>
            </div>
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
            Note: Tier 1–2 require your OpenAI key before they’re fully active (we’ll wire that next).
          </div>
        </>
      )}
    </div>
  );
}