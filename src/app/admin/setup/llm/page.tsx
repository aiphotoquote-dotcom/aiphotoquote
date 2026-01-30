// src/app/admin/setup/llm/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import { TenantLlmManagerClient } from "@/components/pcc/llm/TenantLlmManagerClient";

type TenantRow = {
  tenantId: string;
  slug: string;
  name: string | null;
  role: "owner" | "admin" | "member";
};

type ContextResp =
  | { ok: true; activeTenantId: string | null; tenants: TenantRow[]; message?: string }
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

/**
 * ✅ Deterministic tenant activation:
 * - If activeTenantId exists → use it
 * - Else if exactly 1 tenant → POST select it, then hard reload (so server reads cookie)
 * - Else require user selection
 */
async function ensureActiveTenant(): Promise<string> {
  const ctxRes = await fetch("/api/tenant/context", { cache: "no-store" });
  const ctx = await safeJson<ContextResp>(ctxRes);
  if (!ctx.ok) throw new Error(ctx.message || ctx.error || "Failed to load tenant context");

  if (ctx.activeTenantId) return ctx.activeTenantId;

  const tenants = Array.isArray(ctx.tenants) ? ctx.tenants : [];

  if (tenants.length === 1) {
    const t0 = tenants[0];
    const setRes = await fetch("/api/tenant/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: t0.tenantId }),
    });
    const setJson = await safeJson<any>(setRes);
    if (!setJson?.ok) throw new Error(setJson?.message || setJson?.error || "Failed to auto-select tenant");

    // Hard reload ensures ALL server reads see cookie immediately
    window.location.reload();
    // This line won't realistically run, but TS wants a return:
    return t0.tenantId;
  }

  throw new Error("No active tenant selected. Use the tenant switcher to pick a tenant.");
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
        const tid = await ensureActiveTenant();
        if (cancelled) return;
        setTenantId(tid);

        const res2 = await fetch("/api/tenant/me-settings", { cache: "no-store" });
        const ms = await safeJson<MeSettingsResponse>(res2);

        if (!cancelled) {
          if (!("ok" in ms) || !ms.ok) setIndustryKey(null);
          else setIndustryKey(ms.settings?.industry_key ?? null);
        }
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
          Tenant overrides layered on top of industry + platform defaults. Guardrails are platform-locked.
        </p>
      </div>

      <TenantLlmManagerClient tenantId={tenantId} industryKey={industryKey} />
    </div>
  );
}