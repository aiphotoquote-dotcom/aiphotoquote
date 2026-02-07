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
  if (t === "tier1") return "Boost your business";
  return "Maximize your workflow";
}

function tierPrice(t: PlanTier) {
  if (t === "tier0") return { dollars: 0, note: "No card required" };
  if (t === "tier1") return { dollars: 49, note: "Best for most shops" };
  return { dollars: 199, note: "For power users" };
}

function tierUsage(t: PlanTier) {
  // purely cosmetic; doesn’t affect limits
  if (t === "tier0") return { label: "AI Usage", filled: 2, total: 5 };
  if (t === "tier1") return { label: "AI Usage", filled: 4, total: 6 };
  return { label: "AI Usage", filled: 6, total: 6 };
}

function tierDetails(t: PlanTier) {
  if (t === "tier0") {
    return [
      "5 quotes / month",
      "Uses platform AI keys",
      "Multiple users",
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

function tierAccent(t: PlanTier) {
  // Tailwind-safe static classes
  if (t === "tier0") {
    return {
      glow: "shadow-[0_0_0_1px_rgba(15,23,42,0.12),0_10px_30px_rgba(15,23,42,0.12)] dark:shadow-[0_0_0_1px_rgba(148,163,184,0.12),0_12px_36px_rgba(0,0,0,0.45)]",
      borderGrad: "from-slate-200 via-slate-100 to-slate-200 dark:from-slate-800 dark:via-slate-900 dark:to-slate-800",
      badge: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-200",
      check: "text-emerald-600 dark:text-emerald-400",
      price: "text-slate-900 dark:text-white",
    };
  }
  if (t === "tier1") {
    return {
      glow:
        "shadow-[0_0_0_1px_rgba(16,185,129,0.18),0_18px_60px_rgba(16,185,129,0.15)] dark:shadow-[0_0_0_1px_rgba(16,185,129,0.28),0_22px_70px_rgba(0,0,0,0.55)]",
      borderGrad: "from-emerald-200 via-cyan-200 to-indigo-200 dark:from-emerald-700/40 dark:via-cyan-700/30 dark:to-indigo-700/30",
      badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
      check: "text-emerald-600 dark:text-emerald-400",
      price: "text-slate-900 dark:text-white",
    };
  }
  return {
    glow:
      "shadow-[0_0_0_1px_rgba(99,102,241,0.18),0_18px_60px_rgba(99,102,241,0.14)] dark:shadow-[0_0_0_1px_rgba(99,102,241,0.24),0_22px_70px_rgba(0,0,0,0.55)]",
    borderGrad: "from-indigo-200 via-fuchsia-200 to-amber-200 dark:from-indigo-700/35 dark:via-fuchsia-700/25 dark:to-amber-700/20",
    badge: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/45 dark:text-indigo-200",
    check: "text-emerald-600 dark:text-emerald-400",
    price: "text-slate-900 dark:text-white",
  };
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className ?? ""} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M16.704 5.29a1 1 0 01.006 1.414l-7.25 7.29a1 1 0 01-1.423-.005L3.29 9.23a1 1 0 011.42-1.41l3.02 3.04 6.54-6.57a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function UsageMeter({ filled, total, accent }: { filled: number; total: number; accent: PlanTier }) {
  const cells = Array.from({ length: total });
  return (
    <div className="mt-5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-slate-600 dark:text-slate-300">AI Usage</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400">
          {filled}/{total}
        </div>
      </div>
      <div className="mt-2 flex gap-1.5">
        {cells.map((_, i) => {
          const on = i < filled;
          return (
            <div
              key={i}
              className={[
                "h-2.5 flex-1 rounded-sm",
                on
                  ? accent === "tier0"
                    ? "bg-slate-900 dark:bg-white"
                    : accent === "tier1"
                      ? "bg-emerald-500"
                      : "bg-indigo-500"
                  : "bg-slate-200 dark:bg-slate-800",
              ].join(" ")}
              aria-hidden="true"
            />
          );
        })}
      </div>
    </div>
  );
}

function SparkleBg() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]">
      <div className="absolute -top-20 -left-16 h-56 w-56 rounded-full bg-gradient-to-br from-white/50 to-white/0 blur-2xl dark:from-white/10 dark:to-white/0" />
      <div className="absolute -bottom-24 -right-20 h-64 w-64 rounded-full bg-gradient-to-tr from-indigo-400/20 to-transparent blur-3xl dark:from-indigo-500/20" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.25),transparent_40%),radial-gradient(circle_at_70%_30%,rgba(99,102,241,0.10),transparent_45%),radial-gradient(circle_at_50%_90%,rgba(16,185,129,0.10),transparent_40%)] dark:bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.08),transparent_40%),radial-gradient(circle_at_70%_30%,rgba(99,102,241,0.18),transparent_45%),radial-gradient(circle_at_50%_90%,rgba(16,185,129,0.14),transparent_40%)]" />
    </div>
  );
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
      <div className="text-center">
        <div className="text-[11px] font-semibold tracking-[0.28em] text-slate-500 dark:text-slate-400">
          STEP 6 OF 6
        </div>
        <div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
          How much AI do you want working for you?
        </div>
        <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Select the plan that fits your business today. You can change this anytime.
        </div>
      </div>

      {err ? (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
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
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            {cards.map((t) => {
              const active = selected === t;
              const a = tierAccent(t);
              const price = tierPrice(t);
              const usage = tierUsage(t);
              const popular = t === "tier1";

              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setSelected(t)}
                  className={[
                    "relative text-left rounded-[28px] p-[1px] transition",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 dark:focus-visible:ring-slate-500/60",
                    active ? a.glow : "shadow-sm dark:shadow-none",
                  ].join(" ")}
                >
                  <div
                    className={[
                      "absolute inset-0 rounded-[28px]",
                      "bg-gradient-to-br",
                      a.borderGrad,
                      active ? "opacity-100" : "opacity-70",
                    ].join(" ")}
                    aria-hidden="true"
                  />

                  <div
                    className={[
                      "relative rounded-[27px] border",
                      "bg-white/90 dark:bg-slate-950/70 backdrop-blur",
                      active ? "border-white/40 dark:border-white/10" : "border-slate-200 dark:border-slate-800",
                      "px-5 py-5",
                    ].join(" ")}
                  >
                    {active ? <SparkleBg /> : null}

                    {/* Top: force non-overlapping layout */}
                    <div className="relative">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="text-lg font-semibold text-slate-900 dark:text-white">
                              {tierLabel(t)}
                            </div>
                            {popular ? (
                              <span
                                className={[
                                  "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
                                  a.badge,
                                ].join(" ")}
                              >
                                MOST POPULAR
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                            {tierSubtitle(t)}
                          </div>
                        </div>

                        {/* Price: stacked + no wrap collisions */}
                        <div className="shrink-0 text-right">
                          <div className="flex items-baseline justify-end gap-1 whitespace-nowrap">
                            <div className={["text-3xl font-semibold leading-none", a.price].join(" ")}>
                              {price.dollars === 0 ? "Free" : `$${price.dollars}`}
                            </div>
                            <div className="text-sm text-slate-500 dark:text-slate-400">
                              {price.dollars === 0 ? "" : "/ mo"}
                            </div>
                          </div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{price.note}</div>
                        </div>
                      </div>
                    </div>

                    <div className="relative mt-5 h-px w-full bg-slate-200/70 dark:bg-slate-800/70" />

                    <ul className="relative mt-5 space-y-3 text-sm">
                      {tierDetails(t).map((d) => (
                        <li key={d} className="flex items-start gap-2">
                          <CheckIcon className={["mt-0.5 h-4 w-4 shrink-0", a.check].join(" ")} />
                          <span className="text-slate-800 dark:text-slate-200">{d}</span>
                        </li>
                      ))}
                    </ul>

                    <div className="relative">
                      <UsageMeter filled={usage.filled} total={usage.total} accent={t} />
                    </div>

                    <div className="relative mt-5 flex items-center justify-between">
                      <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">{t}</div>

                      {active ? (
                        <span className="inline-flex items-center rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white dark:bg-white dark:text-black">
                          Selected
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">Select</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Bottom value props (removed “No customer pricing shown”) */}
          <div className="mt-6 grid gap-2 text-sm text-slate-600 dark:text-slate-300">
            <div className="flex items-center gap-2">
              <CheckIcon className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              Change plans anytime
            </div>
            <div className="flex items-center gap-2">
              <CheckIcon className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              Manual review always possible
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              className="rounded-2xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-white dark:hover:bg-slate-900"
              onClick={props.onBack}
              disabled={saving}
            >
              Back
            </button>

            <button
              type="button"
              className="rounded-2xl bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-black disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-slate-100"
              onClick={savePlan}
              disabled={!canSave}
            >
              {saving ? "Saving…" : "Save & Finish"}
            </button>
          </div>

          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Note: Tier 1–2 require your OpenAI key before they’re fully active (we’ll wire that next).
          </div>
        </>
      )}
    </div>
  );
}