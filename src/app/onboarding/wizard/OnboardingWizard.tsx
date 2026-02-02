// src/app/onboarding/wizard/OnboardingWizard.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

type OnboardingMode =
  | "new_user_new_tenant"
  | "existing_user_new_tenant"
  | "existing_user_existing_tenant";

type OnboardingState = {
  ok: boolean;
  onboardingMode?: OnboardingMode;
  user?: { name: string | null; email: string | null };

  tenantId: string | null;
  tenantName: string | null;
  currentStep: number;
  completed: boolean;
  website: string | null;
  aiAnalysis: any | null;

  // for error responses (we treat these as optional)
  error?: string;
  message?: string;
};

function safeStep(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(6, Math.floor(n)));
}

function getStepFromUrl(): number {
  if (typeof window === "undefined") return 1;
  const url = new URL(window.location.href);
  return safeStep(url.searchParams.get("step") ?? "1");
}

function setStepInUrl(step: number) {
  const url = new URL(window.location.href);
  url.searchParams.set("step", String(step));
  window.history.replaceState({}, "", url.toString());
}

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

export default function OnboardingWizard() {
  const [step, setStep] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<OnboardingState | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const pct = useMemo(() => {
    const total = 6;
    return Math.round(((Math.min(step, total) - 1) / (total - 1)) * 100);
  }, [step]);

  async function refresh() {
    setErr(null);
    try {
      const res = await fetch("/api/onboarding/state", { method: "GET", cache: "no-store" });
      const j = (await res.json().catch(() => null)) as OnboardingState | null;

      if (!res.ok || !j?.ok) {
        throw new Error((j as any)?.message || (j as any)?.error || `HTTP ${res.status}`);
      }

      setState(j);

      // prefer URL step; fallback to server step
      const urlStep = getStepFromUrl();
      setStep(urlStep || safeStep(j.currentStep || 1));
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const s = getStepFromUrl();
    setStep(s);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function go(next: number) {
    const s = safeStep(next);
    setStepInUrl(s);
    setStep(s);
  }

  async function saveStep1(payload: { businessName: string; website?: string }) {
    setErr(null);
    const res = await fetch("/api/onboarding/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ step: 1, ...payload }),
    });
    const j = (await res.json().catch(() => null)) as any;
    if (!res.ok || !j?.ok) throw new Error(j?.message || j?.error || `Save failed (HTTP ${res.status})`);
    await refresh();
    go(2);
  }

  async function runMockAnalysis() {
    setErr(null);
    const res = await fetch("/api/onboarding/analyze-website", { method: "POST" });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) throw new Error(j?.message || j?.error || `Analyze failed (HTTP ${res.status})`);
    await refresh();
  }

  const onboardingMode: OnboardingMode | undefined = state?.onboardingMode;
  const userName = state?.user?.name ?? null;
  const userEmail = state?.user?.email ?? null;

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="text-sm text-gray-600 dark:text-gray-300">Loading onboarding…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs text-gray-600 dark:text-gray-300">AIPhotoQuote Onboarding</div>
            <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">
              Let’s set up your business
            </div>
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              We’ll tailor your quoting experience in just a few steps.
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Step {step} / 6
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-300">
              {state?.tenantName ? state.tenantName : "New tenant"}
            </div>
          </div>
        </div>

        {/* Signed-in identity banner (server-authoritative) */}
        {(userEmail || userName) && (
          <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
            <div className="font-semibold">Signed in</div>
            <div className="mt-0.5">
              {userName ? <span className="font-medium">{userName}</span> : null}
              {userName && userEmail ? <span className="mx-1 text-gray-400">•</span> : null}
              {userEmail ? <span className="font-mono">{userEmail}</span> : null}
            </div>

            {onboardingMode === "existing_user_existing_tenant" ? (
              <div className="mt-1 text-gray-600 dark:text-gray-300">
                You already have a tenant. This wizard will update your tenant setup.
              </div>
            ) : onboardingMode === "existing_user_new_tenant" ? (
              <div className="mt-1 text-gray-600 dark:text-gray-300">
                We’ll create a new tenant for you (no need to re-enter your name/email).
              </div>
            ) : null}
          </div>
        )}

        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
          <div className="h-full bg-emerald-600 transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>

        {err ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
            {err}
          </div>
        ) : null}

        <div className="mt-6">
          {step === 1 ? (
            <Step1
              onboardingMode={onboardingMode}
              userName={userName}
              userEmail={userEmail}
              onSubmit={saveStep1}
            />
          ) : step === 2 ? (
            <Step2
              website={state?.website || ""}
              aiAnalysis={state?.aiAnalysis}
              onRun={runMockAnalysis}
              onNext={() => go(3)}
              onBack={() => go(1)}
            />
          ) : (
            <ComingSoon step={step} onBack={() => go(step - 1)} />
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none focus:border-gray-400 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
      />
    </label>
  );
}

function Step1({
  onboardingMode,
  userName,
  userEmail,
  onSubmit,
}: {
  onboardingMode: OnboardingMode | undefined;
  userName: string | null;
  userEmail: string | null;
  onSubmit: (payload: { businessName: string; website?: string }) => Promise<void>;
}) {
  const [businessName, setBusinessName] = useState("");
  const [website, setWebsite] = useState("");
  const [saving, setSaving] = useState(false);

  const isExistingUser = onboardingMode === "existing_user_new_tenant" || onboardingMode === "existing_user_existing_tenant";

  const can = businessName.trim().length >= 2;

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">Business identity</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        This helps us personalize your estimates, emails, and branding.
      </div>

      {isExistingUser ? (
        <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
          <div className="font-semibold text-gray-900 dark:text-gray-100">We already know who you are</div>
          <div className="mt-1">
            {userName ? <span className="font-medium">{userName}</span> : null}
            {userName && userEmail ? <span className="mx-1 text-gray-400">•</span> : null}
            {userEmail ? <span className="font-mono">{userEmail}</span> : null}
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Next, we’ll set up your business details.
          </div>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4">
        <Field label="Business name" value={businessName} onChange={setBusinessName} placeholder="Maggio Upholstery" />
        <Field label="Website (optional)" value={website} onChange={setWebsite} placeholder="https://yourshop.com" />
      </div>

      <button
        type="button"
        className="mt-6 w-full rounded-2xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
        disabled={!can || saving}
        onClick={async () => {
          setSaving(true);
          try {
            await onSubmit({
              businessName: businessName.trim(),
              website: website.trim() || undefined,
            });
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "Saving…" : "Continue"}
      </button>
    </div>
  );
}

function Step2({
  website,
  aiAnalysis,
  onRun,
  onNext,
  onBack,
}: {
  website: string;
  aiAnalysis: any | null | undefined;
  onRun: () => Promise<void>;
  onNext: () => void;
  onBack: () => void;
}) {
  const [running, setRunning] = useState(false);

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">AI fit check</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        If you provided a website, we’ll scan it to tailor your setup.
      </div>

      <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="font-medium text-gray-900 dark:text-gray-100">Website</div>
        <div className="mt-1 break-words text-gray-700 dark:text-gray-300">{website || "(none provided)"}</div>
      </div>

      <div className="mt-4 grid gap-3">
        <button
          type="button"
          className="w-full rounded-2xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
          disabled={running}
          onClick={async () => {
            setRunning(true);
            try {
              await onRun();
            } finally {
              setRunning(false);
            }
          }}
        >
          {running ? "Analyzing…" : "Run AI analysis (mock)"}
        </button>

        {aiAnalysis ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
            <div className="font-semibold">Result</div>
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs">{JSON.stringify(aiAnalysis, null, 2)}</pre>
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
            No analysis yet. Click the button to generate a starter result.
          </div>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          type="button"
          className="rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
          onClick={onBack}
        >
          Back
        </button>
        <button
          type="button"
          className="rounded-2xl bg-black py-3 text-sm font-semibold text-white dark:bg-white dark:text-black"
          onClick={onNext}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function ComingSoon({ step, onBack }: { step: number; onBack: () => void }) {
  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">Step {step} coming next</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        Wizard shell is in place. Next we’ll implement industry confirmation + pricing model setup.
      </div>

      <button
        type="button"
        className="mt-6 w-full rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
        onClick={onBack}
      >
        Back
      </button>
    </div>
  );
}