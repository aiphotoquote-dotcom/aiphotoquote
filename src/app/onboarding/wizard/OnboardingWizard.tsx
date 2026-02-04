// src/app/onboarding/wizard/OnboardingWizard.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type OnboardingMode = "default" | "new" | "edit";

type OnboardingState = {
  ok: boolean;
  tenantId: string | null;
  tenantName: string | null;
  currentStep: number;
  completed: boolean;
  website: string | null;
  aiAnalysis: any | null;

  error?: string;
  message?: string;
};

type IndustryItem = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  source: "platform" | "tenant";
};

type IndustriesResponse = {
  ok: boolean;
  tenantId: string;
  selectedKey: string | null;
  industries: IndustryItem[];
  error?: string;
  message?: string;
};

function safeStep(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(6, Math.floor(n)));
}

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function getParams() {
  if (typeof window === "undefined") return { step: 1, mode: "default" as OnboardingMode, tenantId: "" };
  const url = new URL(window.location.href);
  const step = safeStep(url.searchParams.get("step") ?? "1");

  const rawMode = safeTrim(url.searchParams.get("mode")).toLowerCase();
  const mode: OnboardingMode = rawMode === "new" ? "new" : rawMode === "edit" ? "edit" : "default";

  const tenantId = safeTrim(url.searchParams.get("tenantId"));
  return { step, mode, tenantId };
}

function setStepInUrl(step: number) {
  const url = new URL(window.location.href);
  url.searchParams.set("step", String(step));
  window.history.replaceState({}, "", url.toString());
}

function setTenantIdInUrl(tenantId: string) {
  const url = new URL(window.location.href);
  if (tenantId) url.searchParams.set("tenantId", tenantId);
  else url.searchParams.delete("tenantId");
  window.history.replaceState({}, "", url.toString());
}

export default function OnboardingWizard() {
  const initial = getParams();

  const [step, setStep] = useState<number>(initial.step);
  const [mode, setMode] = useState<OnboardingMode>(initial.mode);
  const [targetTenantId, setTargetTenantId] = useState<string>(initial.tenantId);

  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<OnboardingState | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const pct = useMemo(() => {
    const total = 6;
    return Math.round(((Math.min(step, total) - 1) / (total - 1)) * 100);
  }, [step]);

  function go(next: number) {
    const s = safeStep(next);
    setStepInUrl(s);
    setStep(s);
  }

  async function refresh(nextTenantId?: string) {
    setErr(null);
    try {
      const tid = safeTrim(nextTenantId ?? targetTenantId);

      // If we are editing a specific tenant, ask the API for that tenant's onboarding state.
      const qs = tid ? `?tenantId=${encodeURIComponent(tid)}` : "";
      const res = await fetch(`/api/onboarding/state${qs}`, { method: "GET", cache: "no-store" });

      const j = (await res.json().catch(() => null)) as OnboardingState | null;
      if (!res.ok || !j?.ok) throw new Error(j?.message || j?.error || `HTTP ${res.status}`);

      setState(j);

      // If server returns tenantId and we didn't have one (or we were in new mode), lock it in.
      const serverTenantId = safeTrim(j.tenantId);
      if (serverTenantId && serverTenantId !== tid) {
        setTargetTenantId(serverTenantId);
        setTenantIdInUrl(serverTenantId);
      }

      // prefer URL step; fallback to server step
      const url = getParams();
      setMode(url.mode); // keep mode synced if user changes URL
      setStep(url.step || safeStep(j.currentStep || 1));
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const url = getParams();
    setStep(url.step);
    setMode(url.mode);
    setTargetTenantId(url.tenantId);
    refresh(url.tenantId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * ENTRY POINT LOGIC:
   * - mode=default => legacy: existing tenant if present; otherwise create first tenant
   * - mode=new     => existing user/new tenant: ALWAYS create a new tenant
   * - mode=edit    => existing user/existing tenant: must have tenantId in URL
   */
  const existingUserContext = Boolean(state?.tenantId) && mode !== "new";

  async function saveStep1(payload: { businessName: string; website?: string; ownerName?: string; ownerEmail?: string }) {
    setErr(null);

    const isNewTenantFlow = mode === "new";
    const isEditFlow = mode === "edit";
    const tenantId = safeTrim(targetTenantId);

    const body: any = { step: 1, ...payload };

    if (isNewTenantFlow) {
      body.createNewTenant = true;
    }

    if (isEditFlow) {
      if (!tenantId) throw new Error("MISSING_TENANT_ID: edit mode requires ?tenantId=");
      body.tenantId = tenantId;
    }

    const res = await fetch("/api/onboarding/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) throw new Error(j?.message || j?.error || `Save failed (HTTP ${res.status})`);

    // When creating a new tenant, server returns tenantId — lock it as the target.
    const newTenantId = safeTrim(j?.tenantId);
    if (newTenantId) {
      setTargetTenantId(newTenantId);
      setTenantIdInUrl(newTenantId);
    }

    await refresh(newTenantId);
    go(2);
  }

  async function runMockAnalysis() {
    setErr(null);

    const tenantId = safeTrim(state?.tenantId || targetTenantId);
    if (!tenantId) throw new Error("NO_TENANT: onboarding state did not include tenantId.");

    const res = await fetch("/api/onboarding/analyze-website", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId }),
    });

    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) throw new Error(j?.message || j?.error || `Analyze failed (HTTP ${res.status})`);
    await refresh(tenantId);
  }

  async function saveIndustrySelection(args: { industryKey?: string; industryLabel?: string }) {
    setErr(null);

    const tenantId = safeTrim(state?.tenantId || targetTenantId);
    if (!tenantId) throw new Error("NO_TENANT: cannot save industry without tenantId.");

    const res = await fetch("/api/onboarding/industries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId, ...args }),
    });

    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) throw new Error(j?.message || j?.error || `Save failed (HTTP ${res.status})`);

    await refresh(tenantId);
    go(4);
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

  const headerTenantName = state?.tenantName ? state.tenantName : mode === "new" ? "New tenant" : "Tenant";

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

            {/* Lightweight mode badge for debugging */}
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Mode: <span className="font-mono">{mode}</span>
              {targetTenantId ? (
                <>
                  {" "}
                  • Tenant: <span className="font-mono">{targetTenantId.slice(0, 8)}…</span>
                </>
              ) : null}
            </div>
          </div>

          <div className="shrink-0 text-right">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Step {step} / 6</div>
            <div className="text-xs text-gray-600 dark:text-gray-300">{headerTenantName}</div>
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
              onRun={runMockAnalysis}
              onNext={() => go(3)}
              onBack={() => go(1)}
            />
          ) : step === 3 ? (
            <Step3
              tenantId={safeTrim(state?.tenantId || targetTenantId)}
              aiAnalysis={state?.aiAnalysis}
              onBack={() => go(2)}
              onSubmit={saveIndustrySelection}
            />
          ) : (
            <ComingSoon step={step} onBack={() => go(step - 1)} />
          )}
        </div>
      </div>
    </div>
  );
}

/* --- rest of file (Field, Step1, Step2, Step3, ComingSoon) --- */

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
  existingUser,
  onSubmit,
}: {
  existingUser: boolean;
  onSubmit: (payload: { businessName: string; website?: string; ownerName?: string; ownerEmail?: string }) => Promise<void>;
}) {
  const [businessName, setBusinessName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [saving, setSaving] = useState(false);

  const can =
    businessName.trim().length >= 2 &&
    (existingUser ? true : ownerName.trim().length >= 2 && ownerEmail.trim().includes("@"));

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">Business identity</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        This helps us personalize your estimates, emails, and branding.
      </div>

      <div className="mt-6 grid gap-4">
        <Field label="Business name" value={businessName} onChange={setBusinessName} placeholder="Maggio Upholstery" />

        {existingUser ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
            We already know who you are from your login — no need to re-enter your name and email.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Your name" value={ownerName} onChange={setOwnerName} placeholder="Joe Maggio" />
            <Field label="Your email" value={ownerEmail} onChange={setOwnerEmail} placeholder="you@shop.com" type="email" />
          </div>
        )}

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
              ownerName: existingUser ? undefined : ownerName.trim(),
              ownerEmail: existingUser ? undefined : ownerEmail.trim(),
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
  const autoRanRef = useRef(false);

  useEffect(() => {
    if (autoRanRef.current) return;

    const hasWebsite = String(website ?? "").trim().length > 0;
    const hasAnalysis = Boolean(aiAnalysis);

    autoRanRef.current = true;
    if (!hasWebsite || hasAnalysis) return;

    let alive = true;

    setRunning(true);
    onRun()
      .catch(() => {})
      .finally(() => {
        if (alive) setRunning(false);
      });

    return () => {
      alive = false;
    };
  }, [website, aiAnalysis, onRun]);

  const buttonLabel = aiAnalysis ? "Re-run AI analysis (mock)" : "Run AI analysis (mock)";

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
          {running ? "Analyzing…" : buttonLabel}
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

function Step3({
  tenantId,
  aiAnalysis,
  onBack,
  onSubmit,
}: {
  tenantId: string;
  aiAnalysis: any | null | undefined;
  onBack: () => void;
  onSubmit: (args: { industryKey?: string; industryLabel?: string }) => Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<IndustryItem[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [createMode, setCreateMode] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const suggestedKey = String(aiAnalysis?.suggestedIndustryKey ?? "").trim();

  async function loadIndustries() {
    setErr(null);
    setLoading(true);
    try {
      const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
      const res = await fetch(`/api/onboarding/industries${qs}`, { method: "GET", cache: "no-store" });

      const j = (await res.json().catch(() => null)) as IndustriesResponse | null;
      if (!res.ok || !j?.ok) throw new Error(j?.message || j?.error || `HTTP ${res.status}`);

      const list = Array.isArray(j.industries) ? j.industries : [];
      setItems(list);

      const serverSel = String(j.selectedKey ?? "").trim();
      const hasSuggested = suggestedKey && list.some((x) => x.key === suggestedKey);
      const next =
        (serverSel && list.some((x) => x.key === serverSel) ? serverSel : "") ||
        (hasSuggested ? suggestedKey : "") ||
        (list[0]?.key ?? "");

      setSelectedKey(next);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadIndustries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSave = createMode ? newLabel.trim().length >= 2 : Boolean(selectedKey);

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">Confirm your industry</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        This lets us load the right prompts, pricing defaults, and language for your customers.
      </div>

      {suggestedKey ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
          <div className="font-semibold">AI suggestion</div>
          <div className="mt-1">
            Suggested industry key: <span className="font-mono text-xs">{suggestedKey}</span>
          </div>
        </div>
      ) : null}

      {err ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}

      <div className="mt-5 rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Choose an industry</div>
          <button
            type="button"
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
            onClick={() => {
              setCreateMode((v) => !v);
              setNewLabel("");
            }}
          >
            {createMode ? "Select existing" : "Create new"}
          </button>
        </div>

        {loading ? (
          <div className="mt-4 text-sm text-gray-600 dark:text-gray-300">Loading industries…</div>
        ) : createMode ? (
          <div className="mt-4 grid gap-3">
            <Field label="New industry label" value={newLabel} onChange={setNewLabel} placeholder="e.g., Marine upholstery" />
            <div className="text-xs text-gray-600 dark:text-gray-300">
              We’ll save this as a tenant-specific industry (doesn’t change the global platform list yet).
            </div>
          </div>
        ) : (
          <div className="mt-4 grid gap-3">
            <label className="block">
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Industry</div>
              <select
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
                className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none focus:border-gray-400 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              >
                {items.map((x) => (
                  <option key={x.id} value={x.key}>
                    {x.label} {x.source === "tenant" ? "(your tenant)" : ""}
                  </option>
                ))}
              </select>
            </label>

            {selectedKey ? (
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
                <div className="font-semibold text-gray-900 dark:text-gray-100">Selected key</div>
                <div className="mt-1 font-mono text-xs">{selectedKey}</div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          type="button"
          className="rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
          onClick={onBack}
          disabled={saving}
        >
          Back
        </button>
        <button
          type="button"
          className="rounded-2xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
          disabled={!canSave || saving}
          onClick={async () => {
            setSaving(true);
            setErr(null);
            try {
              if (createMode) {
                await onSubmit({ industryLabel: newLabel.trim() });
              } else {
                await onSubmit({ industryKey: selectedKey });
              }
            } catch (e: any) {
              setErr(e?.message ?? String(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Continue"}
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
        Wizard shell is in place. Next we’ll implement pricing model setup + plan selection.
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