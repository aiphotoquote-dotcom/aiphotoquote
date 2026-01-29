// src/app/admin/setup/ai-policy/page.tsx

"use client";

import React, { useEffect, useMemo, useState } from "react";
import TenantLlmBehaviorAdvanced from "@/components/pcc/llm/TenantLlmBehaviorAdvanced";

type AiMode = "assessment_only" | "range" | "fixed";
type RenderingStyle = "photoreal" | "clean_oem" | "custom";

type PolicyResp =
  | {
      ok: true;
      tenantId: string;
      role: "owner" | "admin" | "member";
      ai_policy: {
        ai_mode: AiMode;
        pricing_enabled: boolean;

        rendering_enabled: boolean;
        rendering_style: RenderingStyle;
        rendering_notes: string;
        rendering_max_per_day: number;
        rendering_customer_opt_in_required: boolean;
      };
    }
  | { ok: false; error: string; message?: string; issues?: any };

async function safeJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Expected JSON but got "${ct || "unknown"}" (status ${res.status}). First 80 chars: ${text.slice(0, 80)}`
    );
  }
  return (await res.json()) as T;
}

function Card({
  title,
  desc,
  selected,
  onClick,
}: {
  title: string;
  desc: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "w-full text-left rounded-xl border p-4 hover:bg-gray-50",
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

export default function AiPolicySetupPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [role, setRole] = useState<"owner" | "admin" | "member" | null>(null);

  // Existing policy
  const [aiMode, setAiMode] = useState<AiMode>("assessment_only");
  const [pricingEnabled, setPricingEnabled] = useState(false);

  // Rendering policy
  const [renderingEnabled, setRenderingEnabled] = useState(false);
  const [renderingStyle, setRenderingStyle] = useState<RenderingStyle>("photoreal");
  const [renderingNotes, setRenderingNotes] = useState("");
  const [renderingMaxPerDay, setRenderingMaxPerDay] = useState<number>(20);
  const [renderingOptInRequired, setRenderingOptInRequired] = useState(true);

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const canEdit = useMemo(() => role === "owner" || role === "admin", [role]);

  async function load() {
    setErr(null);
    setMsg(null);
    setLoading(true);

    try {
      // Ensure active tenant cookie exists
      await fetch("/api/tenant/context", { cache: "no-store" });

      const res = await fetch("/api/admin/ai-policy", { cache: "no-store" });
      const data = await safeJson<PolicyResp>(res);
      if (!data.ok) throw new Error(data.message || data.error || "Failed to load AI policy");

      setRole(data.role);

      setAiMode(data.ai_policy.ai_mode);
      setPricingEnabled(!!data.ai_policy.pricing_enabled);

      setRenderingEnabled(!!data.ai_policy.rendering_enabled);
      setRenderingStyle(data.ai_policy.rendering_style ?? "photoreal");
      setRenderingNotes(data.ai_policy.rendering_notes ?? "");
      setRenderingMaxPerDay(
        Number.isFinite(data.ai_policy.rendering_max_per_day) ? data.ai_policy.rendering_max_per_day : 20
      );
      setRenderingOptInRequired(!!data.ai_policy.rendering_customer_opt_in_required);
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
      const payload = {
        ai_mode: aiMode,
        pricing_enabled: pricingEnabled,

        rendering_enabled: renderingEnabled,
        rendering_style: renderingStyle,
        rendering_notes: renderingNotes,
        rendering_max_per_day: Math.max(0, Math.min(1000, Number(renderingMaxPerDay) || 0)),
        rendering_customer_opt_in_required: renderingOptInRequired,
      };

      const res = await fetch("/api/admin/ai-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await safeJson<PolicyResp>(res);
      if (!data.ok) throw new Error(data.message || data.error || "Failed to save AI policy");

      setMsg("Saved.");
      setRole(data.role);

      setAiMode(data.ai_policy.ai_mode);
      setPricingEnabled(!!data.ai_policy.pricing_enabled);

      setRenderingEnabled(!!data.ai_policy.rendering_enabled);
      setRenderingStyle(data.ai_policy.rendering_style ?? "photoreal");
      setRenderingNotes(data.ai_policy.rendering_notes ?? "");
      setRenderingMaxPerDay(
        Number.isFinite(data.ai_policy.rendering_max_per_day) ? data.ai_policy.rendering_max_per_day : 20
      );
      setRenderingOptInRequired(!!data.ai_policy.rendering_customer_opt_in_required);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-3xl p-6 bg-gray-50 min-h-screen">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Setup: AI & Pricing Policy</h1>
          <p className="mt-1 text-sm text-gray-600">
            Decide what the AI returns to customers, and optionally enable concept renderings.
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
          <a
            href="/admin"
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

            {/* AI Mode */}
            <div className="grid gap-3">
              <div className="text-sm font-semibold text-gray-900">AI Mode</div>

              <Card
                title="Assessment only (recommended default)"
                desc="AI describes visible damage, scope, assumptions, and questions. No pricing shown."
                selected={aiMode === "assessment_only"}
                onClick={() => canEdit && setAiMode("assessment_only")}
              />

              <Card
                title="Estimate range"
                desc="AI can return a low/high range (we’ll wire this to your pricing config next)."
                selected={aiMode === "range"}
                onClick={() => canEdit && setAiMode("range")}
              />

              <Card
                title="Fixed estimate"
                desc="AI returns a single estimate (best for standardized services)."
                selected={aiMode === "fixed"}
                onClick={() => canEdit && setAiMode("fixed")}
              />
            </div>

            {/* Pricing enabled */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Pricing Enabled</div>
                  <div className="mt-1 text-xs text-gray-600">
                    If off, we never show price numbers even if AI mode supports them.
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
            </div>

            {/* Rendering policy */}
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-gray-900">AI Renderings</div>
                  <div className="mt-1 text-xs text-gray-600">
                    Optional “concept render” image of the finished product. Costs more than text — keep this
                    tenant-controlled.
                  </div>
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
                  <p className="mt-1 text-xs text-gray-500">
                    This is a v1 preset. We’ll expand these into per-tenant style templates later.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-800">House style notes (optional)</label>
                  <textarea
                    value={renderingNotes}
                    onChange={(e) => setRenderingNotes(e.target.value)}
                    disabled={!canEdit || !renderingEnabled}
                    rows={4}
                    placeholder="Example: Keep original stitching pattern; show clean restored bolsters; avoid changing color unless requested…"
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

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs text-gray-700">
                  We’ll enforce this later in <span className="font-mono">/api/quote/submit</span>:
                  <ul className="list-disc pl-5 mt-2 space-y-1">
                    <li>
                      Only attempt rendering if <span className="font-mono">rendering_enabled</span> is true
                    </li>
                    <li>
                      Require customer checkbox when{" "}
                      <span className="font-mono">rendering_customer_opt_in_required</span> is true
                    </li>
                    <li>
                      Rate limit using <span className="font-mono">rendering_max_per_day</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            {/* LLM Behavior (Advanced) — platform read-only + tenant overrides */}
            <TenantLlmBehaviorAdvanced />

            {/* Save */}
            <div className="flex items-center gap-4">
              <button
                onClick={save}
                disabled={!canEdit || saving}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save Policy"}
              </button>

              {msg && <span className="text-sm text-green-700">{msg}</span>}
              {err && <span className="text-sm text-red-700 whitespace-pre-wrap">{err}</span>}
            </div>

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
          </div>
        )}
      </div>
    </div>
  );
}