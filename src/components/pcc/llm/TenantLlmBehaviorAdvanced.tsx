// src/components/pcc/llm/TenantLlmBehaviorAdvanced.tsx
"use client";

import React, { useEffect, useState } from "react";
import { TenantLlmManagerClient } from "@/components/pcc/llm/TenantLlmManagerClient";

type ContextResp =
  | { ok: true; activeTenantId: string | null; tenants: Array<any> }
  | { ok: false; error: string; message?: string };

type MeSettingsResponse =
  | {
      ok: true;
      tenant: { id: string; name: string; slug: string };
      settings:
        | {
            tenant_id: string;
            industry_key: string | null;
            redirect_url: string | null;
            thank_you_url: string | null;
            updated_at: string | null;
          }
        | null;
    }
  | { ok: false; error: any; message?: string };

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

export default function TenantLlmBehaviorAdvanced() {
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [industryKey, setIndustryKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setErr(null);
      setLoading(true);

      try {
        // 1) Ensure tenant context exists + cookie is set if auto-select is possible
        const ctxRes = await fetch("/api/tenant/context", {
          cache: "no-store",
          credentials: "include",
        });
        const ctx = await safeJson<ContextResp>(ctxRes);
        if (!ctx.ok) throw new Error(ctx.message || ctx.error || "Failed to load tenant context");
        if (!ctx.activeTenantId) throw new Error("Select a tenant first.");

        if (cancelled) return;
        setTenantId(ctx.activeTenantId);

        // 2) Load industry key (optional, used for effective LLM layering)
        const msRes = await fetch("/api/tenant/me-settings", {
          cache: "no-store",
          credentials: "include",
        });
        const ms = await safeJson<MeSettingsResponse>(msRes);

        if (cancelled) return;
        if (ms && "ok" in ms && ms.ok) setIndustryKey(ms.settings?.industry_key ?? null);
        else setIndustryKey(null);
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

  // Keep the card looking the same as your other panels
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Tenant LLM settings</div>
          <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            Tenant overrides apply on top of industry + platform defaults.
          </div>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
          Loading tenant…
        </div>
      ) : err ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
          {err}
        </div>
      ) : tenantId ? (
        <div className="mt-6">
          {/* IMPORTANT: forces clean remount if tenant changes */}
          <TenantLlmManagerClient key={tenantId} tenantId={tenantId} industryKey={industryKey} />
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
          Select a tenant first.
        </div>
      )}
    </div>
  );
}