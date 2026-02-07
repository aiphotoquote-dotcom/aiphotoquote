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
  return "Growth";
}

function tierSubtitle(t: PlanTier) {
  if (t === "tier0") return "Get started free (limited)";
  if (t === "tier1") return "For small teams shipping fast";
  return "For growing teams that need scale";
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

function priceLine(t: PlanTier) {
  if (t === "tier0") return { price: "$0", period: "/mo", note: "No card required" };
  if (t === "tier1") return { price: "$49", period: "/mo", note: "Best for most shops" };
  return { price: "$149", period: "/mo", note: "Built for volume" };
}

function badge(t: PlanTier) {
  if (t === "tier1") return { label: "Most popular", tone: "good" as const };
  if (t === "tier2") return { label: "Best value", tone: "neutral" as const };
  return null;
}

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function CheckIcon({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border",
        active
          ? "border-white/30 bg-white/15 text-white dark:border-black/20 dark:bg-black/10 dark:text-black"
          : "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
      )}
      aria-hidden="true"
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
        <path
          fillRule="evenodd"
          d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.2 7.28a1 1 0 0 1-1.42 0l-3.2-3.24a1 1 0 1 1 1.422-1.406l2.49 2.52 6.49-6.568a1 1 0 0 1 1.412 0Z"
          clipRule="evenodd"
        />
      </svg>
    </span>
  );
}

function TinyPill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "warn";
}) {
  const cls =
    tone === "good"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
      : tone === "warn"
      ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-950/30 dark:text-yellow-100"
      : "border-gray-200 bg-white text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200";

  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold", cls)}>
      {children}
    </span>
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
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">Choose your plan</div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Pick what fits today. You can change this later.
          </div>
        </div>

        <div className="shrink-0 hidden sm:flex items-center gap-2">
          <TinyPill>Step 6 of 6</TinyPill>
        </div>
      </div>

      {err ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}

      {/* Saved state */}
      {done ? (
        <div className="mt-6 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900/40 dark:bg-emerald-950/30">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">Plan saved ✅</div>
              <div className="mt-1 text-sm text-emerald-900/90 dark:text-emerald-100/90">
                Selected: <span className="font-mono">{savedPlan}</span>.
                {needsKey ? (
                  <> Next: add your OpenAI key to activate Tier 1–2, then set up your widget.</>
                ) : (
                  <> Next: set up your widget so customers can submit photos from your website.</>
                )}
              </div>
            </div>
            <div className="hidden sm:flex">
              <TinyPill tone="good">Ready</TinyPill>
            </div>
          </div>

          <div className="mt-4 grid gap-3">
            <button
              type="button"
              className="w-full rounded-2xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:opacity-95"
              onClick={props.openWidgetSetup}
            >
              Open Widget setup
            </button>

            <button
              type="button"
              className="w-full rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
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
          {/* Cards */}
          <div className="mt-6 grid gap-3">
            {cards.map((t) => {
              const active = selected === t;
              const p = priceLine(t);
              const b = badge(t);

              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setSelected(t)}
                  className={cn(
                    "group relative text-left rounded-3xl border p-4 transition overflow-hidden",
                    "focus:outline-none focus:ring-2 focus:ring-gray-900/20 dark:focus:ring-white/20",
                    active
                      ? "border-gray-900 bg-gray-900 text-white shadow-sm dark:border-white dark:bg-white dark:text-black"
                      : "border-gray-200 bg-white text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
                  )}
                >
                  {/* subtle highlight */}
                  <div
                    className={cn(
                      "pointer-events-none absolute inset-0 opacity-0 transition-opacity",
                      active ? "opacity-100" : "group-hover:opacity-100"
                    )}
                    aria-hidden="true"
                  >
                    <div
                      className={cn(
                        "absolute -top-24 -right-24 h-56 w-56 rounded-full blur-3xl",
                        active
                          ? "bg-white/15 dark:bg-black/10"
                          : "bg-gray-100 dark:bg-white/5"
                      )}
                    />
                    <div
                      className={cn(
                        "absolute -bottom-28 -left-28 h-64 w-64 rounded-full blur-3xl",
                        active
                          ? "bg-white/10 dark:bg-black/10"
                          : "bg-gray-100 dark:bg-white/5"
                      )}
                    />
                  </div>

                  <div className="relative">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="text-base font-semibold">{tierLabel(t)}</div>
                          {b ? (
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold border",
                                active
                                  ? "border-white/25 bg-white/15 text-white dark:border-black/15 dark:bg-black/10 dark:text-black"
                                  : b.tone === "good"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
                                  : "border-gray-200 bg-white text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
                              )}
                            >
                              {b.label}
                            </span>
                          ) : null}
                        </div>

                        <div className={cn("mt-0.5 text-sm", active ? "opacity-90" : "text-gray-600 dark:text-gray-300")}>
                          {tierSubtitle(t)}
                        </div>
                      </div>

                      {/* Price */}
                      <div className="shrink-0 text-right">
                        <div className={cn("flex items-baseline justify-end gap-1", active ? "" : "")}>
                          <div className={cn("text-xl font-semibold", active ? "" : "")}>{p.price}</div>
                          <div className={cn("text-sm", active ? "opacity-85" : "text-gray-600 dark:text-gray-300")}>
                            {p.period}
                          </div>
                        </div>
                        <div className={cn("mt-0.5 text-[11px]", active ? "opacity-85" : "text-gray-500 dark:text-gray-400")}>
                          {p.note}
                        </div>
                      </div>
                    </div>

                    {/* Features */}
                    <div className="mt-4 grid gap-2">
                      {tierDetails(t).map((d) => (
                        <div key={d} className="flex items-start gap-2">
                          <CheckIcon active={active} />
                          <div className={cn("text-sm", active ? "opacity-95" : "text-gray-700 dark:text-gray-200")}>
                            {d}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Selected footer */}
                    <div className="mt-4 flex items-center justify-between">
                      <div className={cn("text-xs font-mono", active ? "opacity-85" : "text-gray-500 dark:text-gray-400")}>
                        {t}
                      </div>
                      <div
                        className={cn(
                          "text-xs font-semibold",
                          active ? "opacity-95" : "text-gray-600 dark:text-gray-300"
                        )}
                      >
                        {active ? "Selected" : "Select"}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Actions */}
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              className="rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
              onClick={props.onBack}
              disabled={saving}
            >
              Back
            </button>

            <button
              type="button"
              className="rounded-2xl bg-black py-3 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50 dark:bg-white dark:text-black"
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