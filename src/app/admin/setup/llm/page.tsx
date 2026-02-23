// src/app/admin/setup/llm/page.tsx
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
      `Expected JSON but got "${ct || "unknown"}" (status ${res.status}). First 80 chars: ${text.slice(0, 80)}`
    );
  }
  return (await res.json()) as T;
}

export default function AdminSetupLlmPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [industryKey, setIndustryKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setErr(null);

      try {
        const res1 = await fetch("/api/tenant/context", { cache: "no-store" });
        const ctx = await safeJson<ContextResp>(res1);
        if (!ctx.ok) throw new Error(ctx.message || ctx.error || "Failed to load tenant context");
        if (!ctx.activeTenantId) throw new Error("No active tenant selected. Use the tenant switcher.");

        if (cancelled) return;
        setTenantId(ctx.activeTenantId);

        const res2 = await fetch("/api/tenant/me-settings", { cache: "no-store" });
        const ms = await safeJson<MeSettingsResponse>(res2);
        if (cancelled) return;

        setIndustryKey(ms && "ok" in ms && ms.ok ? ms.settings?.industry_key ?? null : null);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? String(e));
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
          {err}
        </div>
      </div>
    );
  }

  if (!tenantId) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-700 dark:border-gray-800 dark:bg-neutral-950 dark:text-gray-200">
          Loading tenant…
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">LLM Settings</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          Prompts are layered: <span className="font-mono">platform → industry → tenant</span>. Tenant entries are optional and only apply on top of the
          baseline. Guardrails are platform-locked.
        </p>
      </div>

      <TenantLlmManagerClient key={`${tenantId}:${industryKey ?? ""}`} tenantId={tenantId} industryKey={industryKey} />
    </div>
  );
}