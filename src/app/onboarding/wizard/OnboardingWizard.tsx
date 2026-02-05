"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Mode = "new" | "update" | "existing";

type OnboardingState = {
  ok: boolean;
  isAuthenticated?: boolean;
  tenantId: string | null;
  tenantName: string | null;
  currentStep: number;
  completed: boolean;
  website: string | null;
  aiAnalysis: any | null;

  // NOTE: state API may also return convenience fields; we ignore if missing
  aiAnalysisStatus?: string | null;
  aiAnalysisRound?: number | null;
  aiAnalysisLastAction?: string | null;
  aiAnalysisError?: string | null;

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

function safeMode(v: any): Mode {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "update") return "update";
  if (s === "existing") return "existing";
  return "new";
}

function normalizeWebsiteInput(raw: string) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) return `https://${s}`;
  return s;
}

function getUrlParams() {
  if (typeof window === "undefined") return { step: 1, mode: "new" as Mode, tenantId: "" };
  const url = new URL(window.location.href);
  const step = safeStep(url.searchParams.get("step") ?? "1");
  const mode = safeMode(url.searchParams.get("mode"));
  const tenantId = String(url.searchParams.get("tenantId") ?? "").trim();
  return { step, mode, tenantId };
}

function setUrlParams(next: { step?: number; mode?: Mode; tenantId?: string }) {
  const url = new URL(window.location.href);

  if (typeof next.step === "number") url.searchParams.set("step", String(safeStep(next.step)));
  if (next.mode) url.searchParams.set("mode", next.mode);

  if (typeof next.tenantId === "string") {
    const tid = next.tenantId.trim();
    if (tid) url.searchParams.set("tenantId", tid);
    else url.searchParams.delete("tenantId");
  }

  window.history.replaceState({}, "", url.toString());
}

function buildStateUrl(mode: Mode, tenantId: string) {
  const qs = new URLSearchParams();
  qs.set("mode", mode);
  if (tenantId) qs.set("tenantId", tenantId);
  return `/api/onboarding/state?${qs.toString()}`;
}

function buildIndustriesUrl(tenantId: string) {
  const qs = new URLSearchParams();
  qs.set("tenantId", tenantId);
  return `/api/onboarding/industries?${qs.toString()}`;
}

function getConfidence(aiAnalysis: any | null | undefined) {
  const n = Number(aiAnalysis?.confidenceScore ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function needsConfirmation(aiAnalysis: any | null | undefined) {
  const v = aiAnalysis?.needsConfirmation;
  if (typeof v === "boolean") return v;
  return getConfidence(aiAnalysis) < 0.8;
}

function formatHttpError(j: any, res: Response) {
  const msg = String(j?.message || j?.error || "").trim();
  return msg || `Request failed (HTTP ${res.status})`;
}

function getMetaStatus(aiAnalysis: any | null | undefined) {
  const s = String(aiAnalysis?.meta?.status ?? "").trim();
  return s || "";
}

function getMetaLastAction(aiAnalysis: any | null | undefined) {
  const s = String(aiAnalysis?.meta?.lastAction ?? "").trim();
  return s || "";
}

function getPreviewText(aiAnalysis: any | null | undefined) {
  // Primary
  const p = String(aiAnalysis?.extractedTextPreview ?? "").trim();
  if (p) return p;

  // Secondary: sometimes people store it nested
  const p2 = String(aiAnalysis?.debug?.extractedTextPreview ?? "").trim();
  if (p2) return p2;

  // Otherwise empty
  return "";
}

function summarizeFetchDebug(aiAnalysis: any | null | undefined) {
  const fd = aiAnalysis?.fetchDebug ?? null;
  if (!fd) return null;

  const aggregateChars = Number(fd?.aggregateChars ?? 0) || 0;
  const pagesUsed: string[] = Array.isArray(fd?.pagesUsed) ? fd.pagesUsed : [];
  const attempted: any[] = Array.isArray(fd?.attempted) ? fd.attempted : [];
  const pagesAttempted: any[] = Array.isArray(fd?.pagesAttempted) ? fd.pagesAttempted : [];

  // Simple “why” heuristics for UI
  let hint: string | null = null;
  if (aggregateChars < 200) {
    // look for notes
    const notes: string[] = [];
    for (const a of attempted) {
      const n = String(a?.note ?? "").trim();
      if (n) notes.push(n);
    }
    for (const a of pagesAttempted) {
      const n = String(a?.note ?? "").trim();
      if (n) notes.push(n);
    }
    const uniq = Array.from(new Set(notes)).slice(0, 2);
    hint = uniq.length
      ? uniq.join(" / ")
      : "Very little readable text was extracted. This usually means the site is JS-rendered, blocked, or mostly images.";
  }

  return { aggregateChars, pagesUsed, attemptedCount: attempted.length, pagesAttemptedCount: pagesAttempted.length, hint };
}

export default function OnboardingWizard() {
  const [{ step, mode, tenantId }, setNav] = useState(() => getUrlParams());

  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<OnboardingState | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // keep local UX action (button clicks)
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
    // Prefer derived state fields if present, else aiAnalysis.meta.lastAction
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

      const status =
        String(j?.aiAnalysisStatus ?? "").trim() ||
        String(j?.aiAnalysis?.meta?.status ?? "").trim();

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

    // Kick off request (do not await yet)
    const req = fetch("/api/onboarding/analyze-website", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: tid }),
    });

    // Immediately poll so UI reflects DB "running" meta updates while POST is still in-flight
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

    // Only poll if the "no" path triggers a re-run
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

            {/* prefer server last action, fall back to local click-based action */}
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
          ) : (
            <ComingSoon step={step} onBack={() => go(step - 1)} />
          )}
        </div>
      </div>
    </div>
  );
}

/* --------------------- UI helpers --------------------- */

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
  aiAnalysisStatus,
  aiAnalysisError,
  onRun,
  onConfirm,
  onNext,
  onBack,
  onError,
}: {
  website: string;
  aiAnalysis: any | null | undefined;
  aiAnalysisStatus?: string;
  aiAnalysisError?: string | null;
  onRun: () => Promise<void>;
  onConfirm: (args: { answer: "yes" | "no"; feedback?: string }) => Promise<void>;
  onNext: () => void;
  onBack: () => void;
  onError: (msg: string) => void;
}) {
  const [running, setRunning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState("");
  const autoRanRef = useRef(false);

  const conf = getConfidence(aiAnalysis);
  const mustConfirm = needsConfirmation(aiAnalysis);

  const businessGuess = String(aiAnalysis?.businessGuess ?? "").trim();
  const questions: string[] = Array.isArray(aiAnalysis?.questions) ? aiAnalysis.questions : [];

  const preview = getPreviewText(aiAnalysis);
  const fetchSummary = summarizeFetchDebug(aiAnalysis);

  // Prefer server status if present (avoid “stuck analyzing” UX)
  const serverSaysAnalyzing = String(aiAnalysisStatus ?? "").toLowerCase() === "running";
  const showAnalyzing = running || serverSaysAnalyzing;

  useEffect(() => {
    if (autoRanRef.current) return;

    const hasWebsite = String(website ?? "").trim().length > 0;
    const hasAnalysis = Boolean(aiAnalysis);

    autoRanRef.current = true;
    if (!hasWebsite || hasAnalysis) return;

    let alive = true;
    setRunning(true);
    onRun()
      .catch((e: any) => {
        const msg = e?.message ?? String(e);
        onError(msg);
      })
      .finally(() => {
        if (alive) setRunning(false);
      });

    return () => {
      alive = false;
    };
  }, [website, aiAnalysis, onRun, onError]);

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">AI fit check</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        We’ll scan your website to understand what you do, then confirm it with you.
      </div>

      <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="font-medium text-gray-900 dark:text-gray-100">Website</div>
        <div className="mt-1 break-words text-gray-700 dark:text-gray-300">{website || "(none provided)"}</div>
      </div>

      {aiAnalysisError ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {aiAnalysisError}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3">
        <button
          type="button"
          className="w-full rounded-2xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
          disabled={showAnalyzing}
          onClick={async () => {
            setRunning(true);
            try {
              await onRun();
            } catch (e: any) {
              onError(e?.message ?? String(e));
            } finally {
              setRunning(false);
            }
          }}
        >
          {showAnalyzing ? "Analyzing…" : aiAnalysis ? "Re-run website analysis" : "Run website analysis"}
        </button>

        {aiAnalysis ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
            <div className="flex items-center justify-between gap-3">
              <div className="font-semibold">What we think you do</div>
              <div className="text-xs">
                Confidence: <span className="font-mono">{Math.round(conf * 100)}%</span>
              </div>
            </div>

            <div className="mt-2 text-sm">{businessGuess || "Analysis returned no summary."}</div>

            {questions.length ? (
              <div className="mt-3 text-xs opacity-90">
                <div className="font-semibold">Quick check</div>
                <ul className="mt-1 list-disc pl-5">
                  {questions.slice(0, 4).map((q, i) => (
                    <li key={i}>{String(q)}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-4 rounded-xl border border-emerald-300/40 bg-white/60 p-3 dark:bg-black/20">
              <div className="text-xs font-semibold">Does this sound correct?</div>

              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <button
                  type="button"
                  className="rounded-xl bg-black px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
                  disabled={confirming}
                  onClick={async () => {
                    setConfirming(true);
                    try {
                      await onConfirm({ answer: "yes" });
                      setFeedback("");
                    } catch (e: any) {
                      onError(e?.message ?? String(e));
                    } finally {
                      setConfirming(false);
                    }
                  }}
                >
                  {confirming ? "Saving…" : "Yes, that’s right"}
                </button>

                <button
                  type="button"
                  className="rounded-xl border border-emerald-300/50 bg-transparent px-4 py-2 text-xs font-semibold text-emerald-950 disabled:opacity-50 dark:text-emerald-100"
                  disabled={confirming}
                  onClick={async () => {
                    setConfirming(true);
                    try {
                      await onConfirm({ answer: "no", feedback: feedback.trim() || undefined });
                    } catch (e: any) {
                      onError(e?.message ?? String(e));
                    } finally {
                      setConfirming(false);
                    }
                  }}
                >
                  {confirming ? "Saving…" : "Not quite"}
                </button>
              </div>

              <div className="mt-2">
                <div className="text-xs text-emerald-950/80 dark:text-emerald-100/80">
                  If not correct, tell us what you do (boats/cars/etc. + services). We’ll re-evaluate.
                </div>
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  rows={4}
                  placeholder="Example: We do custom automotive upholstery (seats + door panels), headliners, and marine vinyl repairs. We do not do painting."
                  className="mt-2 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none dark:border-emerald-900/40 dark:bg-gray-950 dark:text-gray-100"
                />
              </div>

              {mustConfirm ? (
                <div className="mt-2 text-xs text-emerald-950/80 dark:text-emerald-100/80">
                  We’ll ask for confirmation until confidence is high enough to categorize your business automatically.
                </div>
              ) : (
                <div className="mt-2 text-xs text-emerald-950/80 dark:text-emerald-100/80">
                  Nice — confidence looks good. You can continue to industry selection.
                </div>
              )}
            </div>

            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold opacity-90">Debug preview (text sample)</summary>

              {fetchSummary ? (
                <div className="mt-2 rounded-xl border border-emerald-300/40 bg-white/60 p-3 text-[11px] leading-snug dark:bg-black/20">
                  <div className="font-semibold">Extractor summary</div>
                  <div className="mt-1">
                    Aggregate chars: <span className="font-mono">{fetchSummary.aggregateChars}</span>
                    {" • "}
                    Pages used: <span className="font-mono">{fetchSummary.pagesUsed.length}</span>
                    {" • "}
                    Base attempts: <span className="font-mono">{fetchSummary.attemptedCount}</span>
                  </div>
                  {fetchSummary.pagesUsed.length ? (
                    <div className="mt-1 break-words">
                      Used:
                      <ul className="mt-1 list-disc pl-5">
                        {fetchSummary.pagesUsed.slice(0, 4).map((u, i) => (
                          <li key={i} className="break-all">
                            {u}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {fetchSummary.hint ? <div className="mt-2 italic opacity-90">{fetchSummary.hint}</div> : null}
                </div>
              ) : null}

              <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-snug">
                {preview || "(no preview — extractor did not capture readable text)"}
              </pre>
            </details>
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

        <div className="grid gap-2">
          <button
            type="button"
            className="rounded-2xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
            disabled={!aiAnalysis || mustConfirm}
            onClick={onNext}
            title={mustConfirm ? "Please confirm/correct the website analysis first." : ""}
          >
            Continue
          </button>

          <button
            type="button"
            className="rounded-2xl border border-gray-200 bg-white py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
            disabled={!aiAnalysis}
            onClick={onNext}
          >
            Continue anyway
          </button>
        </div>
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
  tenantId: string | null;
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
      const tid = String(tenantId ?? "").trim();
      if (!tid) throw new Error("NO_TENANT: missing tenantId for industries load.");

      const res = await fetch(buildIndustriesUrl(tid), { method: "GET", cache: "no-store" });
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
  }, [tenantId]);

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
              if (createMode) await onSubmit({ industryLabel: newLabel.trim() });
              else await onSubmit({ industryKey: selectedKey });
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