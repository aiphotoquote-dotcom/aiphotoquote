// src/app/admin/setup/plan/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type PlanTier = "free" | "pro" | "business";

type PlanState = {
  tier: PlanTier;
  monthlyQuoteLimit: number | null;
  activationGraceCredits: number;
  activationGraceUsed: number;
  planSelectedAt: string | null;
};

function cx(...x: Array<string | false | null | undefined>) {
  return x.filter(Boolean).join(" ");
}

function Card({
  title,
  subtitle,
  bullets,
  priceHint,
  tier,
  selected,
  onPick,
  disabled,
}: {
  title: string;
  subtitle: string;
  bullets: string[];
  priceHint?: string;
  tier: PlanTier;
  selected: boolean;
  onPick: (t: PlanTier) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(tier)}
      disabled={disabled}
      className={cx(
        "w-full text-left rounded-2xl border p-5 transition shadow-sm",
        "bg-white hover:bg-gray-50 dark:bg-zinc-950 dark:hover:bg-zinc-900",
        selected
          ? "border-black ring-2 ring-black dark:border-white dark:ring-white"
          : "border-gray-200 dark:border-zinc-800",
        disabled ? "opacity-60 cursor-not-allowed" : ""
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-extrabold text-gray-900 dark:text-white">{title}</div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">{subtitle}</div>
        </div>
        {priceHint ? (
          <div className="text-sm font-bold text-gray-900 dark:text-white">{priceHint}</div>
        ) : (
          <div className="text-sm font-bold text-gray-900 dark:text-white">—</div>
        )}
      </div>

      <ul className="mt-4 space-y-2 text-sm text-gray-700 dark:text-gray-200">
        {bullets.map((b, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[2px] inline-block h-4 w-4 rounded-full border border-gray-300 dark:border-zinc-700" />
            <span>{b}</span>
          </li>
        ))}
      </ul>

      {selected ? (
        <div className="mt-4 inline-flex items-center rounded-full bg-black px-3 py-1 text-xs font-extrabold text-white dark:bg-white dark:text-black">
          Selected
        </div>
      ) : null}
    </button>
  );
}

export default function SetupPlanPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [plan, setPlan] = useState<PlanState | null>(null);
  const [picked, setPicked] = useState<PlanTier>("free");

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/admin/plan", { method: "GET" });
        const j = await res.json().catch(() => null);
        if (!j?.ok) throw new Error(j?.error || "Failed to load plan.");

        const p: PlanState = j.plan;
        setPlan(p);
        setPicked(p?.tier ?? "free");
      } catch (e: any) {
        setError(e?.message ?? "Failed to load plan.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const graceHint = useMemo(() => {
    // This is UX-only. Enforcement comes later.
    const grace = plan?.activationGraceCredits ?? 30;
    return Math.max(0, grace);
  }, [plan]);

  async function saveAndContinue() {
    setError(null);
    setSaving(true);

    try {
      const res = await fetch("/api/admin/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier: picked }),
      });

      const j = await res.json().catch(() => null);
      if (!j?.ok) {
        const msg = j?.message || j?.error || "Save failed.";
        throw new Error(msg);
      }

      // Next step: keys (OpenAI) if paid tiers, otherwise proceed to final step or dashboard.
      // We’re NOT implementing Stripe here. This is just the onboarding flow.
      if (picked === "free") {
        router.push("/admin/setup/finish");
      } else {
        router.push("/admin/setup/openai");
      }
    } catch (e: any) {
      setError(e?.message ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="mb-6">
        <div className="text-2xl font-extrabold text-gray-900 dark:text-white">Choose your plan</div>
        <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          You can change this later. Paid plans require your own OpenAI key for ongoing use — we’ll guide you next.{" "}
          {graceHint ? (
            <span className="font-semibold">
              Paid plans include a short activation allowance ({graceHint} credits) so you can get started immediately.
            </span>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200 whitespace-pre-wrap">
          <div className="font-semibold mb-1">There was a problem</div>
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-gray-200">
          Loading…
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          <Card
            tier="free"
            title="Free Trial"
            subtitle="Get started fast with platform AI (limited use)"
            priceHint="$0"
            bullets={[
              "Uses AI Photo Quote platform AI",
              "Limited monthly usage (cap tuned later)",
              "Single user",
              "Perfect to test the workflow end-to-end",
            ]}
            selected={picked === "free"}
            onPick={setPicked}
          />

          <Card
            tier="pro"
            title="Professional"
            subtitle="For small shops — predictable monthly usage"
            priceHint="Paid"
            bullets={[
              "50 AI quotes per month",
              "Multiple users",
              "Bring your own OpenAI key for ongoing use",
              graceHint ? `Activation allowance: ${graceHint} credits while you connect your key` : "Short activation allowance while you connect your key",
            ]}
            selected={picked === "pro"}
            onPick={setPicked}
          />

          <Card
            tier="business"
            title="Business"
            subtitle="Unlimited quotes for teams"
            priceHint="Paid"
            bullets={[
              "Unlimited AI quotes",
              "Multiple users",
              "Bring your own OpenAI key for ongoing use",
              graceHint ? `Activation allowance: ${graceHint} credits while you connect your key` : "Short activation allowance while you connect your key",
            ]}
            selected={picked === "business"}
            onPick={setPicked}
          />
        </div>
      )}

      <div className="mt-6 flex items-center justify-between gap-3">
        <button
          type="button"
          className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-900 hover:bg-gray-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-white dark:hover:bg-zinc-900"
          onClick={() => router.push("/admin/setup/branding")}
          disabled={saving}
        >
          Back
        </button>

        <button
          type="button"
          className="rounded-xl bg-black px-5 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-60 dark:bg-white dark:text-black"
          onClick={saveAndContinue}
          disabled={saving || loading}
        >
          {saving ? "Saving…" : "Save & continue"}
        </button>
      </div>

      <div className="mt-6 text-xs text-gray-500 dark:text-gray-400">
        Note: Payment processing is not implemented yet. This step stores your plan choice and routes you through onboarding.
      </div>
    </div>
  );
}