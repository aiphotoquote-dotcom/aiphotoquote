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

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={["h-4 w-4 shrink-0", className].join(" ")} fill="none">
      <path
        d="M16.25 5.75L8.5 13.5L4.75 9.75"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UsageBars({
  filled,
  total,
  barClass,
}: {
  filled: number;
  total: number;
  barClass: string;
}) {
  return (
    <div className="mt-2 flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => {
        const on = i < filled;
        return (
          <div
            key={i}
            className={["h-2 w-7 rounded-full", on ? barClass : "bg-slate-200 dark:bg-slate-800"].join(" ")}
          />
        );
      })}
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

  const plans = useMemo(() => {
    return [
      {
        tier: "tier0" as const,
        name: "Starter",
        subtitle: "Try AI quoting for free",
        price: { dollars: 0, note: "No card required" },
        popular: false,
        usage: { filled: 2, total: 5 },
        accent: {
          border: "border-slate-200 dark:border-slate-800",
          ring: "ring-slate-200/70 dark:ring-slate-800/60",
          usage: "bg-slate-900 dark:bg-slate-200",
          glow:
            "bg-[radial-gradient(circle_at_35%_25%,rgba(148,163,184,0.30),transparent_55%)] dark:bg-[radial-gradient(circle_at_35%_25%,rgba(148,163,184,0.18),transparent_60%)]",
        },
        features: ["5 quotes / month", "Uses platform AI keys", "Multiple users", "Upgrade anytime"],
      },
      {
        tier: "tier1" as const,
        name: "Pro",
        subtitle: "Boost your business",
        price: { dollars: 49, note: "Best for most shops" },
        popular: true,
        usage: { filled: 4, total: 6 },
        accent: {
          border: "border-emerald-200/70 dark:border-emerald-900/40",
          ring: "ring-emerald-200/70 dark:ring-emerald-900/30",
          usage: "bg-emerald-500",
          glow:
            "bg-[radial-gradient(circle_at_30%_25%,rgba(16,185,129,0.40),transparent_55%),radial-gradient(circle_at_70%_35%,rgba(99,102,241,0.34),transparent_60%),radial-gradient(circle_at_50%_85%,rgba(34,211,238,0.26),transparent_62%)] dark:bg-[radial-gradient(circle_at_30%_25%,rgba(16,185,129,0.24),transparent_60%),radial-gradient(circle_at_70%_35%,rgba(99,102,241,0.22),transparent_65%),radial-gradient(circle_at_50%_85%,rgba(34,211,238,0.14),transparent_70%)]",
        },
        features: [
          "50 quotes / month",
          "Multiple users",
          "Requires tenant OpenAI key to go live",
          "Includes 30 grace credits while you add your key",
        ],
      },
      {
        tier: "tier2" as const,
        name: "Unlimited",
        subtitle: "Maximize your workflow",
        price: { dollars: 199, note: "For power users" },
        popular: false,
        usage: { filled: 6, total: 6 },
        accent: {
          border: "border-indigo-200/70 dark:border-indigo-900/40",
          ring: "ring-indigo-200/70 dark:ring-indigo-900/30",
          usage: "bg-indigo-500",
          glow:
            "bg-[radial-gradient(circle_at_20%_15%,rgba(99,102,241,0.38),transparent_55%),radial-gradient(circle_at_70%_30%,rgba(168,85,247,0.28),transparent_60%),radial-gradient(circle_at_50%_95%,rgba(34,211,238,0.18),transparent_60%)] dark:bg-[radial-gradient(circle_at_20%_15%,rgba(99,102,241,0.26),transparent_62%),radial-gradient(circle_at_70%_30%,rgba(168,85,247,0.18),transparent_66%),radial-gradient(circle_at_50%_95%,rgba(34,211,238,0.10),transparent_72%)]",
        },
        features: [
          "Unlimited quotes",
          "Multiple users",
          "Requires tenant OpenAI key to go live",
          "Includes 30 grace credits while you add your key",
        ],
      },
    ];
  }, []);

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
        body: JSON.stringify({ step: 6, tenantId: tid, plan: selected }),
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
    <div className="relative">
      {/* soft stage (keeps your nice glow) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-6 mx-auto h-[520px] max-w-5xl overflow-hidden rounded-[40px]"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_15%,rgba(15,23,42,0.10),transparent_55%)] dark:bg-[radial-gradient(circle_at_50%_15%,rgba(15,23,42,0.55),transparent_60%)]" />
        <div className="absolute -inset-24 blur-3xl opacity-80 dark:opacity-70 bg-[radial-gradient(circle_at_20%_25%,rgba(16,185,129,0.16),transparent_55%),radial-gradient(circle_at_55%_15%,rgba(99,102,241,0.14),transparent_56%),radial-gradient(circle_at_85%_35%,rgba(168,85,247,0.12),transparent_58%)]" />
      </div>

      <div className="relative">
        <div className="text-center">
          <div className="text-[11px] font-semibold tracking-[0.22em] text-slate-500 dark:text-slate-400">STEP 6 OF 6</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">How much AI do you want working for you?</div>
          <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Select the plan that fits your business today. You can change this anytime.
          </div>
        </div>

        {err ? (
          <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
            {err}
          </div>
        ) : null}

        {done ? (
          <div className="mt-7 rounded-3xl border border-emerald-200 bg-emerald-50 p-6 dark:border-emerald-900/40 dark:bg-emerald-950/30">
            <div className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">Plan saved ✅</div>
            <div className="mt-1 text-sm text-emerald-900/90 dark:text-emerald-100/90">
              Selected: <span className="font-mono">{savedPlan}</span>.
              {needsKey ? (
                <> Next: add your OpenAI key to activate Tier 1–2, then set up your widget.</>
              ) : (
                <> Next: set up your widget so customers can submit photos from your website.</>
              )}
            </div>

            <div className="mt-5 grid gap-3">
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
          </div>
        ) : (
          <>
            <div className="mt-7 grid gap-4 md:grid-cols-3">
              {plans.map((p) => {
                const active = selected === p.tier;

                return (
                  <button
                    key={p.tier}
                    type="button"
                    onClick={() => setSelected(p.tier)}
                    className={[
                      "group relative text-left rounded-[28px] border bg-white p-5 shadow-sm transition dark:bg-gray-950",
                      active ? "shadow-md" : "hover:shadow-md",
                      p.accent.border,
                    ].join(" ")}
                  >
                    {/* per-card glow */}
                    <div
                      aria-hidden="true"
                      className={[
                        "pointer-events-none absolute -inset-8 rounded-[44px] blur-3xl transition-opacity",
                        p.accent.glow,
                        active ? "opacity-100" : "opacity-55",
                      ].join(" ")}
                    />

                    <div className={["relative rounded-[22px] ring-1", p.accent.ring, "bg-white/70 dark:bg-gray-950/55"].join(" ")}>
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 rounded-[22px] bg-[radial-gradient(circle_at_18%_10%,rgba(255,255,255,0.60),transparent_38%)] dark:bg-[radial-gradient(circle_at_18%_10%,rgba(255,255,255,0.10),transparent_44%)]"
                      />
                      <div className="relative p-5">
                        {/* HEADER (simple + safe) */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              {/* truncate prevents overlap */}
                              <div className="truncate text-base font-semibold text-gray-900 dark:text-gray-100">{p.name}</div>
                              {p.popular ? (
                                <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100">
                                  MOST POPULAR
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{p.subtitle}</div>
                          </div>

                          {/* price column */}
                          <div className="shrink-0 text-right">
                            <div className="flex items-baseline justify-end gap-1 whitespace-nowrap">
                              <div className="text-3xl font-semibold leading-none text-gray-900 dark:text-gray-100">
                                {p.price.dollars === 0 ? "Free" : `$${p.price.dollars}`}
                              </div>
                              {p.price.dollars === 0 ? null : (
                                <div className="text-sm text-slate-500 dark:text-slate-400">/ mo</div>
                              )}
                            </div>
                            <div className="mt-1 text-[11px] leading-tight text-slate-500 dark:text-slate-400">{p.price.note}</div>
                          </div>
                        </div>

                        <div className="mt-4 h-px w-full bg-slate-200/70 dark:bg-slate-800/70" />

                        <ul className="mt-4 space-y-2.5">
                          {p.features.map((f) => (
                            <li key={f} className="flex items-start gap-2.5 text-sm text-slate-800 dark:text-slate-200">
                              <CheckIcon className="mt-[2px] text-emerald-600" />
                              <span className="leading-snug">{f}</span>
                            </li>
                          ))}
                        </ul>

                        <div className="mt-5">
                          <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            <div>AI Usage</div>
                            <div>
                              {p.usage.filled}/{p.usage.total}
                            </div>
                          </div>
                          <UsageBars filled={p.usage.filled} total={p.usage.total} barClass={p.accent.usage} />
                        </div>

                        <div className="mt-5 flex items-center justify-between">
                          <div className="text-[11px] font-mono text-slate-400">{p.tier}</div>
                          <span
                            className={[
                              "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold",
                              active ? "bg-slate-900 text-white dark:bg-white dark:text-black" : "text-slate-700 dark:text-slate-200",
                            ].join(" ")}
                          >
                            {active ? "Selected" : "Select"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 space-y-2">
              <div className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                <CheckIcon className="mt-[2px] text-emerald-600" />
                <span>Change plans anytime</span>
              </div>
              <div className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                <CheckIcon className="mt-[2px] text-emerald-600" />
                <span>Manual review always possible</span>
              </div>
            </div>

            <div className="mt-7 grid grid-cols-2 gap-3">
              <button
                type="button"
                className="rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 disabled:opacity-60"
                onClick={props.onBack}
                disabled={saving}
              >
                Back
              </button>

              <button
                type="button"
                className="rounded-2xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
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
    </div>
  );
}