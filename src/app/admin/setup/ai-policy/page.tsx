// src/app/admin/setup/ai-policy/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type AiMode = "assessment_only" | "range" | "fixed";
type RenderingStyle = "photoreal" | "clean_oem" | "custom";

type PricingModel =
  | "flat_per_job"
  | "hourly_plus_materials"
  | "per_unit"
  | "packages"
  | "line_items"
  | "inspection_only"
  | "assessment_fee";

type PolicyResp =
  | {
      ok: true;
      tenantId: string;
      role: "owner" | "admin" | "member";
      ai_policy: {
        ai_mode: AiMode;
        pricing_enabled: boolean;

        // optional: populated if tenant_settings.pricing_model exists
        pricing_model?: PricingModel | null;

        rendering_enabled: boolean;
        rendering_style: RenderingStyle;
        rendering_notes: string;
        rendering_max_per_day: number;
        rendering_customer_opt_in_required: boolean;

        live_qa_enabled?: boolean;
        live_qa_max_questions?: number;
      };
    }
  | { ok: false; error: string; message?: string; issues?: any };

async function safeJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Expected JSON but got "${ct || "unknown"}" (status ${res.status}). First 200 chars: ${text.slice(0, 200)}`
    );
  }
  return (await res.json()) as T;
}

function Card({
  title,
  desc,
  selected,
  disabled,
  onClick,
}: {
  title: string;
  desc: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={() => !disabled && onClick()}
      disabled={disabled}
      className={[
        "w-full text-left rounded-xl border p-4",
        disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-gray-50",
        selected ? "border-blue-400 bg-blue-50" : "border-gray-200 bg-white",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">{title}</div>
          <div className="mt-1 text-xs text-gray-600">{desc}</div>
        </div>
        <div
          className={[
            "mt-1 h-5 w-5 rounded-full border flex items-center justify-center",
            selected ? "border-blue-600 bg-blue-600" : "border-gray-300 bg-white",
          ].join(" ")}
        >
          {selected ? <div className="h-2 w-2 rounded-full bg-white" /> : null}
        </div>
      </div>
    </button>
  );
}

function clampInt(v: any, fallback: number, min: number, max: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function pricingModelLabel(v: PricingModel | null | undefined) {
  switch (v) {
    case "flat_per_job":
      return "Flat price per job";
    case "hourly_plus_materials":
      return "Hourly labor + materials";
    case "per_unit":
      return "Per-unit (sq ft / linear ft / per item)";
    case "packages":
      return "Packages / tiers";
    case "line_items":
      return "Line items / menu of services";
    case "inspection_only":
      return "Quote after inspection only";
    case "assessment_fee":
      return "Assessment / diagnostic fee";
    default:
      return "Not set yet";
  }
}

export default function AiPolicySetupPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const onboardingMode = sp.get("onboarding") === "1";
  const returnTo = sp.get("returnTo");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [role, setRole] = useState<"owner" | "admin" | "member" | null>(null);

  const [aiMode, setAiMode] = useState<AiMode>("assessment_only");
  const [pricingEnabled, setPricingEnabled] = useState(false);

  // read-only, sourced from onboarding
  const [pricingModel, setPricingModel] = useState<PricingModel | null>(null);

  const [renderingEnabled, setRenderingEnabled] = useState(false);
  const [renderingStyle, setRenderingStyle] = useState<RenderingStyle>("photoreal");
  const [renderingNotes, setRenderingNotes] = useState("");
  const [renderingMaxPerDay, setRenderingMaxPerDay] = useState<number>(20);
  const [renderingOptInRequired, setRenderingOptInRequired] = useState(true);

  const [liveQaEnabled, setLiveQaEnabled] = useState(false);
  const [liveQaMaxQuestions, setLiveQaMaxQuestions] = useState(3);

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const canEdit = useMemo(() => role === "owner" || role === "admin", [role]);

  function goBackToOnboarding() {
    if (returnTo) router.push(returnTo);
    else router.push("/onboarding/wizard");
  }

  function enforceUiRules(nextPricingEnabled: boolean, nextAiMode: AiMode) {
    // ✅ Your rule: only allow range/fixed when pricing is enabled
    if (!nextPricingEnabled) return { pricingEnabled: false, aiMode: "assessment_only" as AiMode };
    // pricing enabled: keep requested mode
    return { pricingEnabled: true, aiMode: nextAiMode };
  }

  async function load() {
    setErr(null);
    setMsg(null);
    setLoading(true);

    try {
      // ensure cookies are sent/received
      await fetch("/api/tenant/context", { cache: "no-store", credentials: "include" });

      const res = await fetch("/api/admin/ai-policy", { cache: "no-store", credentials: "include" });
      const data = await safeJson<PolicyResp>(res);
      if (!data.ok) throw new Error(data.message || data.error || "Failed to load AI policy");

      setRole(data.role);

      const loadedPricingEnabled = !!data.ai_policy.pricing_enabled;
      const loadedAiMode = (data.ai_policy.ai_mode ?? "assessment_only") as AiMode;
      const enforced = enforceUiRules(loadedPricingEnabled, loadedAiMode);

      setPricingEnabled(enforced.pricingEnabled);
      setAiMode(enforced.aiMode);

      // show onboarding pricing model if present (but UI will hide details when pricing disabled)
      setPricingModel((data.ai_policy.pricing_model ?? null) as PricingModel | null);

      setRenderingEnabled(!!data.ai_policy.rendering_enabled);
      setRenderingStyle((data.ai_policy.rendering_style ?? "photoreal") as RenderingStyle);
      setRenderingNotes(data.ai_policy.rendering_notes ?? "");
      setRenderingMaxPerDay(
        Number.isFinite(data.ai_policy.rendering_max_per_day) ? data.ai_policy.rendering_max_per_day : 20
      );
      setRenderingOptInRequired(!!data.ai_policy.rendering_customer_opt_in_required);

      setLiveQaEnabled(Boolean(data.ai_policy.live_qa_enabled));
      setLiveQaMaxQuestions(clampInt(data.ai_policy.live_qa_max_questions, 3, 1, 10));
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setErr(null);
    setMsg(null);
    setSaving(true);

    try {
      const enforced = enforceUiRules(pricingEnabled, aiMode);

      const payload = {
        // ✅ enforce rule on the wire too (so no “stale state” saves)
        ai_mode: enforced.aiMode,
        pricing_enabled: enforced.pricingEnabled,

        rendering_enabled: renderingEnabled,
        rendering_style: renderingStyle,
        rendering_notes: renderingNotes,
        rendering_max_per_day: Math.max(0, Math.min(1000, Number(renderingMaxPerDay) || 0)),
        rendering_customer_opt_in_required: renderingOptInRequired,

        live_qa_enabled: Boolean(liveQaEnabled),
        live_qa_max_questions: Math.max(1, Math.min(10, Number(liveQaMaxQuestions) || 3)),
      };

      const res = await fetch("/api/admin/ai-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });

      const data = await safeJson<PolicyResp>(res);
      if (!data.ok) throw new Error(data.message || data.error || "Failed to save AI policy");

      setMsg("Saved.");
      setRole(data.role);

      // keep UI in sync (in case backend normalizes)
      const savedPricingEnabled = !!data.ai_policy.pricing_enabled;
      const savedAiMode = (data.ai_policy.ai_mode ?? "assessment_only") as AiMode;
      const ui = enforceUiRules(savedPricingEnabled, savedAiMode);

      setPricingEnabled(ui.pricingEnabled);
      setAiMode(ui.aiMode);

      // keep showing pricing model (read-only, but hidden if pricing disabled)
      setPricingModel((data.ai_policy.pricing_model ?? pricingModel ?? null) as PricingModel | null);

      setRenderingEnabled(!!data.ai_policy.rendering_enabled);
      setRenderingStyle((data.ai_policy.rendering_style ?? "photoreal") as RenderingStyle);
      setRenderingNotes(data.ai_policy.rendering_notes ?? "");
      setRenderingMaxPerDay(
        Number.isFinite(data.ai_policy.rendering_max_per_day) ? data.ai_policy.rendering_max_per_day : 20
      );
      setRenderingOptInRequired(!!data.ai_policy.rendering_customer_opt_in_required);

      setLiveQaEnabled(Boolean(data.ai_policy.live_qa_enabled));
      setLiveQaMaxQuestions(clampInt(data.ai_policy.live_qa_max_questions, 3, 1, 10));

      if (onboardingMode) {
        goBackToOnboarding();
      }
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  // ✅ if user toggles pricing off, immediately snap aiMode to assessment_only
  useEffect(() => {
    if (!pricingEnabled && aiMode !== "assessment_only") {
      setAiMode("assessment_only");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricingEnabled]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const aiModeLocked = !pricingEnabled; // range/fixed locked out when pricing off

  return (
    <div className="mx-auto max-w-3xl p-6 bg-gray-50 min-h-screen">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {onboardingMode ? "Onboarding: AI & Pricing Policy" : "Setup: AI & Pricing Policy"}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Decide what the AI returns, optionally enable renderings, and configure Live Q&amp;A.
          </p>
          {role ? (
            <div className="mt-2 text-sm">
              <span className="rounded-md bg-white border border-gray-200 px-2 py-1 text-gray-800">
                Role: <span className="font-mono">{role}</span>
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex gap-2">
          {onboardingMode ? (
            <button
              onClick={goBackToOnboarding}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
            >
              ← Back to onboarding
            </button>
          ) : (
            <>
              <a
                href="/admin/setup"
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
              >
                ← Setup Home
              </a>
              <button
                onClick={load}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
              >
                Refresh
              </button>
            </>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        {loading ? (
          <div className="text-sm text-gray-700">Loading…</div>
        ) : (
          <div className="grid gap-6">
            {!canEdit ? (
              <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900">
                You can view this page, but only <span className="font-mono">owner</span> or{" "}
                <span className="font-mono">admin</span> can change the policy.
              </div>
            ) : null}

            {/* Pricing enabled */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Pricing Enabled</div>
                  <div className="mt-1 text-xs text-gray-600">
                    If OFF, the system will never show price numbers, and AI Mode is forced to <span className="font-mono">assessment_only</span>.
                  </div>
                </div>

                <button
                  onClick={() => canEdit && setPricingEnabled((v) => !v)}
                  disabled={!canEdit}
                  className={[
                    "rounded-md border px-3 py-2 text-sm font-semibold",
                    pricingEnabled
                      ? "border-green-300 bg-green-50 text-green-800"
                      : "border-gray-300 bg-white text-gray-800",
                    !canEdit ? "opacity-50" : "hover:bg-gray-50",
                  ].join(" ")}
                >
                  {pricingEnabled ? "ON" : "OFF"}
                </button>
              </div>

              {/* Pricing model (read-only) — only meaningful when pricing is enabled */}
              <div className="mt-4 flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Pricing model (from onboarding)</div>
                  <div className="mt-1 text-xs text-gray-600">
                    {pricingEnabled
                      ? "Shown for visibility (read-only). Used as a methodology hint when pricing is enabled."
                      : "Hidden while pricing is disabled (model hints are ignored)."}
                  </div>
                </div>

                <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900">
                  {pricingEnabled ? pricingModelLabel(pricingModel) : "Pricing disabled"}
                </div>
              </div>
            </div>

            {/* AI Mode */}
            <div className="grid gap-3">
              <div className="text-sm font-semibold text-gray-900">
                AI Mode{" "}
                {!pricingEnabled ? (
                  <span className="ml-2 inline-flex items-center rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-semibold text-gray-700">
                    Locked (pricing off)
                  </span>
                ) : null}
              </div>

              <Card
                title="Assessment only (recommended default)"
                desc="AI describes visible damage, scope, assumptions, and questions. No pricing shown."
                selected={aiMode === "assessment_only"}
                disabled={!canEdit}
                onClick={() => canEdit && setAiMode("assessment_only")}
              />
              <Card
                title="Estimate range"
                desc="AI can return a low/high range (only when Pricing Enabled is ON)."
                selected={aiMode === "range"}
                disabled={!canEdit || aiModeLocked}
                onClick={() => canEdit && !aiModeLocked && setAiMode("range")}
              />
              <Card
                title="Fixed estimate"
                desc="AI returns a single estimate (only when Pricing Enabled is ON)."
                selected={aiMode === "fixed"}
                disabled={!canEdit || aiModeLocked}
                onClick={() => canEdit && !aiModeLocked && setAiMode("fixed")}
              />

              {!pricingEnabled ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                  Pricing is OFF, so AI Mode is forced to <span className="font-mono">assessment_only</span> and price numbers are always suppressed.
                </div>
              ) : null}
            </div>

            {/* Live Q&A */}
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Live Q&amp;A</div>
                  <div className="mt-1 text-xs text-gray-600">
                    When enabled, the quote flow asks a few quick follow-up questions before finalizing the estimate.
                  </div>
                </div>

                <button
                  onClick={() => canEdit && setLiveQaEnabled((v) => !v)}
                  disabled={!canEdit}
                  className={[
                    "rounded-md border px-3 py-2 text-sm font-semibold",
                    liveQaEnabled
                      ? "border-green-300 bg-green-50 text-green-800"
                      : "border-gray-300 bg-white text-gray-800",
                    !canEdit ? "opacity-50" : "hover:bg-gray-50",
                  ].join(" ")}
                >
                  {liveQaEnabled ? "Enabled" : "Disabled"}
                </button>
              </div>

              <div className="mt-4 grid gap-4">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="text-sm font-semibold text-gray-900">Max questions</div>
                  <div className="mt-1 text-xs text-gray-600">Recommended: 3–5.</div>

                  <div className="mt-3 flex items-center gap-3">
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={liveQaMaxQuestions}
                      onChange={(e) => setLiveQaMaxQuestions(Number(e.target.value))}
                      disabled={!canEdit || !liveQaEnabled}
                      className="w-full"
                    />
                    <div className="w-10 text-right text-sm font-mono text-gray-900">{liveQaMaxQuestions}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Rendering policy */}
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-gray-900">AI Renderings</div>
                  <div className="mt-1 text-xs text-gray-600">Optional “concept render” image of the finished product.</div>
                </div>

                <button
                  onClick={() => canEdit && setRenderingEnabled((v) => !v)}
                  disabled={!canEdit}
                  className={[
                    "rounded-md border px-3 py-2 text-sm font-semibold",
                    renderingEnabled
                      ? "border-green-300 bg-green-50 text-green-800"
                      : "border-gray-300 bg-white text-gray-800",
                    !canEdit ? "opacity-50" : "hover:bg-gray-50",
                  ].join(" ")}
                >
                  {renderingEnabled ? "Enabled" : "Disabled"}
                </button>
              </div>

              <div className="mt-4 grid gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-800">Rendering style</label>
                  <select
                    value={renderingStyle}
                    onChange={(e) => setRenderingStyle(e.target.value as RenderingStyle)}
                    disabled={!canEdit || !renderingEnabled}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
                  >
                    <option value="photoreal">Photoreal concept</option>
                    <option value="clean_oem">Clean OEM refresh</option>
                    <option value="custom">Custom / show-style</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-800">House style notes (optional)</label>
                  <textarea
                    value={renderingNotes}
                    onChange={(e) => setRenderingNotes(e.target.value)}
                    disabled={!canEdit || !renderingEnabled}
                    rows={4}
                    placeholder="Example: Keep original stitching pattern; show clean restored bolsters…"
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-800">Max renderings per day</label>
                    <input
                      type="number"
                      value={renderingMaxPerDay}
                      onChange={(e) => setRenderingMaxPerDay(parseInt(e.target.value || "0", 10))}
                      disabled={!canEdit || !renderingEnabled}
                      min={0}
                      max={1000}
                      className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
                    />
                    <p className="mt-1 text-xs text-gray-500">0 means disabled by rate limit.</p>
                  </div>

                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-semibold text-gray-900">Customer opt-in required</div>
                        <div className="mt-1 text-xs text-gray-600">
                          If ON, the public form shows a checkbox and only renders when the customer opts in.
                        </div>
                      </div>

                      <button
                        onClick={() => canEdit && setRenderingOptInRequired((v) => !v)}
                        disabled={!canEdit || !renderingEnabled}
                        className={[
                          "rounded-md border px-3 py-2 text-sm font-semibold",
                          renderingOptInRequired
                            ? "border-green-300 bg-green-50 text-green-800"
                            : "border-gray-300 bg-white text-gray-800",
                          !canEdit || !renderingEnabled ? "opacity-50" : "hover:bg-gray-50",
                        ].join(" ")}
                      >
                        {renderingOptInRequired ? "ON" : "OFF"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Save */}
            <div className="flex items-center gap-4">
              <button
                onClick={save}
                disabled={!canEdit || saving}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : onboardingMode ? "Save & return to onboarding" : "Save Policy"}
              </button>

              {msg && <span className="text-sm text-green-700">{msg}</span>}
              {err && <span className="text-sm text-red-700 whitespace-pre-wrap">{err}</span>}
            </div>

            {!onboardingMode ? (
              <div className="flex gap-2">
                <a
                  href="/admin/setup/widget"
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
                >
                  Next: Widget setup →
                </a>
                <a
                  href="/quote"
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
                >
                  Run a test quote →
                </a>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}