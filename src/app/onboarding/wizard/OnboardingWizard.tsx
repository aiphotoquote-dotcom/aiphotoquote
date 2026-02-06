// src/app/onboarding/wizard/OnboardingWizard.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Mode, OnboardingState } from "./types";
import {
  buildStateUrl,
  formatHttpError,
  getMetaLastAction,
  getMetaStatus,
  getUrlParams,
  normalizeWebsiteInput,
  safeStep,
  setUrlParams,
} from "./utils";

import { Step1 } from "./steps/Step1";
import { Step2 } from "./steps/Step2";
import { Step3 } from "./steps/Step3";
import { Step5Branding } from "./steps/Step5Branding";
import { HandoffStep } from "./steps/HandoffStep";
import { Step6Plan } from "./steps/Step6Plan";

export default function OnboardingWizard() {
  const [{ step, mode, tenantId }, setNav] = useState(() => getUrlParams());

  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<OnboardingState | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [lastAction, setLastAction] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const pct = useMemo(() => {
    const total = 6;
    return Math.round(((Math.min(step, total) - 1) / (total - 1)) * 100);
  }, [step]);

  const displayTenantId = useMemo(() => {
    const a = String(state?.tenantId ?? "").trim();
    if (a) return a;
    const b = String(tenantId ?? "").trim();
    if (b) return b;
    return "(none)";
  }, [state?.tenantId, tenantId]);

  const displayTenantName = useMemo(() => {
    const n = String(state?.tenantName ?? "").trim();
    return n || "New tenant";
  }, [state?.tenantName]);

  const serverLastAction = useMemo(() => {
    const a = String(state?.aiAnalysisLastAction ?? "").trim();
    if (a) return a;
    const b = getMetaLastAction(state?.aiAnalysis);
    return b || "";
  }, [state?.aiAnalysisLastAction, state?.aiAnalysis]);

  function go(nextStep: number) {
    const s = safeStep(nextStep);
    setUrlParams({ step: s });
    setNav((p) => ({ ...p, step: s }));
  }

  function setTenantInNav(tid: string) {
    const clean = String(tid ?? "").trim();
    setUrlParams({ tenantId: clean });
    setNav((p) => ({ ...p, tenantId: clean }));
  }

  async function refresh(explicit?: { mode?: Mode; tenantId?: string }): Promise<OnboardingState | null> {
    setErr(null);
    try {
      const navMode = explicit?.mode ?? mode;
      const navTenantId = String(explicit?.tenantId ?? tenantId ?? "").trim();

      const res = await fetch(buildStateUrl(navMode, navTenantId), { method: "GET", cache: "no-store" });
      const j = (await res.json().catch(() => null)) as OnboardingState | null;

      if (!res.ok || !j?.ok) throw new Error(j?.message || j?.error || `HTTP ${res.status}`);

      if (mountedRef.current) setState(j);

      const serverTenantId = String(j.tenantId ?? "").trim();
      if (serverTenantId && serverTenantId !== navTenantId) {
        setTenantInNav(serverTenantId);
      }

      const urlStep = getUrlParams().step;
      const nextStep = urlStep || safeStep(j.currentStep || 1);

      if (nextStep !== step) {
        setUrlParams({ step: nextStep });
        setNav((p) => ({ ...p, step: nextStep }));
      }

      return j;
    } catch (e: any) {
      if (mountedRef.current) setErr(e?.message ?? String(e));
      return null;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    const p = getUrlParams();
    setNav(p);
    setLoading(true);
    refresh({ mode: p.mode, tenantId: p.tenantId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function pollAnalysisUntilSettled(tid: string) {
    const start = Date.now();
    const maxMs = 45_000;

    while (mountedRef.current && Date.now() - start < maxMs) {
      const j = await refresh({ tenantId: tid });

      const status = String(j?.aiAnalysisStatus ?? "").trim() || String(j?.aiAnalysis?.meta?.status ?? "").trim();
      if (status && status.toLowerCase() !== "running") return;

      await sleep(650);
    }
  }

  async function saveStep1(payload: { businessName: string; website?: string; ownerName?: string; ownerEmail?: string }) {
    setErr(null);
    setLastAction(null);

    const res = await fetch(buildStateUrl(mode, String(tenantId ?? "").trim()), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        step: 1,
        ...payload,
        website: payload.website ? normalizeWebsiteInput(payload.website) : undefined,
      }),
    });

    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) throw new Error(formatHttpError(j, res));

    const newTenantId = String(j.tenantId ?? "").trim();
    if (newTenantId) setTenantInNav(newTenantId);

    await refresh({ tenantId: newTenantId || tenantId });
    setLastAction("Saved business identity.");
    go(2);
  }

  async function runWebsiteAnalysis() {
    setErr(null);
    setLastAction(null);

    const tid = String(state?.tenantId ?? tenantId ?? "").trim();
    if (!tid) throw new Error("NO_TENANT: missing tenantId for analysis.");

    const req = fetch("/api/onboarding/analyze-website", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: tid }),
    });

    const poll = pollAnalysisUntilSettled(tid).catch(() => null);

    const res = await req;
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) throw new Error(formatHttpError(j, res));

    await poll;
    await refresh({ tenantId: tid });
    setLastAction("AI analysis complete.");
  }

  async function confirmWebsiteAnalysis(args: { answer: "yes" | "no"; feedback?: string }) {
    setErr(null);
    setLastAction(null);

    const tid = String(state?.tenantId ?? tenantId ?? "").trim();
    if (!tid) throw new Error("NO_TENANT: missing tenantId for confirmation.");

    const req = fetch("/api/onboarding/confirm-website", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: tid, ...args }),
    });

    const poll = args.answer === "no" ? pollAnalysisUntilSettled(tid).catch(() => null) : Promise.resolve();

    const res = await req;
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) throw new Error(formatHttpError(j, res));

    await poll;
    await refresh({ tenantId: tid });
    setLastAction(args.answer === "yes" ? "Confirmed analysis." : "Submitted correction.");
  }

  async function saveIndustrySelection(args: { industryKey?: string; industryLabel?: string }) {
    setErr(null);
    setLastAction(null);

    const tid = String(state?.tenantId ?? tenantId ?? "").trim();
    if (!tid) throw new Error("NO_TENANT: missing tenantId for industry save.");

    const res = await fetch("/api/onboarding/industries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: tid, ...args }),
    });

    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) throw new Error(formatHttpError(j, res));

    await refresh({ tenantId: tid });
    setLastAction("Industry saved.");
    go(4);
  }

  // ✅ ensure admin pages land on the correct tenant (active-tenant cookie)
  async function ensureActiveTenant(tid: string) {
    const tenantIdClean = String(tid ?? "").trim();
    if (!tenantIdClean) return;

    const res = await fetch("/api/tenant/context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: tenantIdClean }),
      credentials: "include", // ✅ critical on iOS Safari
      cache: "no-store",
    });

    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) {
      throw new Error(j?.message || j?.error || `Failed to switch active tenant (HTTP ${res.status})`);
    }
  }

  async function openSetup(path: string) {
    setErr(null);

    const tid = String(state?.tenantId ?? tenantId ?? "").trim();
    if (!tid) throw new Error("NO_TENANT: missing tenantId for setup handoff.");

    await ensureActiveTenant(tid);

    const url = new URL(window.location.origin + path);
    url.searchParams.set("tenantId", tid);

    const returnTo = new URL(window.location.href);
    url.searchParams.set("returnTo", returnTo.pathname + returnTo.search);

    window.location.href = url.pathname + url.search;
  }

  async function saveBrandingStep(payload: { leadToEmail: string; brandLogoUrl?: string | null }) {
    setErr(null);
    setLastAction(null);

    const tid = String(state?.tenantId ?? tenantId ?? "").trim();
    if (!tid) throw new Error("NO_TENANT: missing tenantId for branding save.");

    await ensureActiveTenant(tid);

    const res = await fetch(buildStateUrl(mode, tid), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        step: 5,
        tenantId: tid,
        lead_to_email: payload.leadToEmail.trim(),
        brand_logo_url: (payload.brandLogoUrl ?? "").trim() ? (payload.brandLogoUrl ?? "").trim() : null,
      }),
    });

    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) throw new Error(formatHttpError(j, res));

    await refresh({ tenantId: tid });
    setLastAction("Saved branding & lead routing.");
    go(6);
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="text-sm text-gray-600 dark:text-gray-300">Loading onboarding…</div>
        </div>
      </div>
    );
  }

  const existingUserContext = Boolean(state?.isAuthenticated ?? true);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs text-gray-600 dark:text-gray-300">AIPhotoQuote Onboarding</div>
            <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">Let’s set up your business</div>
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              We’ll tailor your quoting experience in just a few steps.
            </div>

            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Mode: <span className="font-mono">{mode}</span> {" • "}
              Tenant: <span className="font-mono">{displayTenantId}</span>
            </div>

            {serverLastAction ? (
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Last action: {serverLastAction}</div>
            ) : lastAction ? (
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Last action: {lastAction}</div>
            ) : null}
          </div>

          <div className="shrink-0 text-right">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Step {step} / 6</div>
            <div className="text-xs text-gray-600 dark:text-gray-300">{displayTenantName}</div>
          </div>
        </div>

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
            <Step1 existingUser={existingUserContext} onSubmit={saveStep1} />
          ) : step === 2 ? (
            <Step2
              website={state?.website || ""}
              aiAnalysis={state?.aiAnalysis}
              aiAnalysisStatus={String(state?.aiAnalysisStatus ?? "").trim() || getMetaStatus(state?.aiAnalysis)}
              aiAnalysisError={String(state?.aiAnalysisError ?? "").trim()}
              onRun={runWebsiteAnalysis}
              onConfirm={confirmWebsiteAnalysis}
              onNext={() => go(3)}
              onBack={() => go(1)}
              onError={(m) => setErr(m)}
            />
          ) : step === 3 ? (
            <Step3
              tenantId={String(state?.tenantId ?? tenantId ?? "").trim() || null}
              aiAnalysis={state?.aiAnalysis}
              onBack={() => go(2)}
              onSubmit={saveIndustrySelection}
            />
          ) : step === 4 ? (
            <HandoffStep
              title="AI & Pricing Policy"
              desc="Reuse the full admin setup screen to configure AI mode, Live Q&A, and render policy."
              primaryLabel="Open AI Policy setup"
              onPrimary={() => openSetup("/admin/setup/ai-policy").catch((e: any) => setErr(e?.message ?? String(e)))}
              onBack={() => go(3)}
              onContinue={() => go(5)}
              note="Tip: click Save Policy on that page, then come back here and continue."
            />
          ) : step === 5 ? (
            <Step5Branding
              tenantId={String(state?.tenantId ?? tenantId ?? "").trim() || null}
              aiAnalysis={state?.aiAnalysis}
              ensureActiveTenant={ensureActiveTenant}
              onBack={() => go(4)}
              onSubmit={saveBrandingStep}
            />
          ) : (
            <Step6Plan
              tenantId={String(state?.tenantId ?? tenantId ?? "").trim() || null}
              currentPlan={(state?.planTier as any) ?? null}
              onBack={() => go(5)}
              onSaved={(p) => {
                setLastAction(`Plan saved: ${p}`);
                refresh({ tenantId: String(state?.tenantId ?? tenantId ?? "").trim() }).catch(() => null);
              }}
              openWidgetSetup={() => openSetup("/admin/setup/widget").catch((e: any) => setErr(e?.message ?? String(e)))}
            />
          )}
        </div>
      </div>
    </div>
  );
}