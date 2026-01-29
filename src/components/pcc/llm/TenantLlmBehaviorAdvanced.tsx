// src/components/pcc/llm/TenantLlmBehaviorAdvanced.tsx
"use client";

import React, { useEffect, useState } from "react";
import { LlmManagerClient, type PlatformLlmConfig } from "./LlmManagerClient";

/**
 * Tenant-side “LLM Behavior (Advanced)”
 * - Shows platform config summary (read-only) + allows tenant overrides (editable)
 *
 * NOTE: Right now we re-use the existing PCC config UI (platform config).
 * Next step: wire /api/tenant/llm and change this component to show:
 *   - platform config: read-only
 *   - tenant overrides: editable form
 */
export default function TenantLlmBehaviorAdvanced() {
  const [loading, setLoading] = useState(true);
  const [cfg, setCfg] = useState<PlatformLlmConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setErr(null);
      setLoading(true);
      try {
        // This endpoint already exists (your PCC platform config manager)
        const res = await fetch("/api/pcc/llm/config", { method: "GET", cache: "no-store" });
        const json = await res.json();

        if (cancelled) return;

        if (!json?.ok) throw new Error(json?.message || json?.error || "Failed to load LLM config");
        setCfg(json.config ?? {});
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-2">
        <div className="text-sm font-semibold text-gray-900">LLM Behavior (Advanced)</div>
        <div className="mt-1 text-xs text-gray-600">
          Platform defaults + tenant-level overrides. (We’ll lock guardrails at platform level next.)
        </div>
      </div>

      {loading ? <div className="text-sm text-gray-700">Loading…</div> : null}

      {err ? <div className="mt-2 text-sm text-red-700 whitespace-pre-wrap">{err}</div> : null}

      {!loading && !err && cfg ? (
        <div className="mt-4">
          <LlmManagerClient initialConfig={cfg} />
        </div>
      ) : null}
    </section>
  );
}