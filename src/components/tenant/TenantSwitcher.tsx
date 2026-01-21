// src/components/tenant/TenantSwitcher.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

type TenantRow = {
  tenantId: string;
  slug: string;
  name: string | null;
  role: "owner" | "admin" | "member";
};

type TenantListResp =
  | { ok: true; tenants: TenantRow[] }
  | { ok: false; error: string; message?: string };

type TenantContextResp =
  | { ok: true; activeTenantId: string | null; tenants: TenantRow[] }
  | { ok: false; error: string; message?: string };

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

export default function TenantSwitcher({
  className,
  variant = "select",
}: {
  className?: string;
  variant?: "select" | "pills";
}) {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const LIST_URL = "/api/tenant/list";
  const CONTEXT_URL = "/api/tenant/context";

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [listRes, ctxRes] = await Promise.all([
        fetch(LIST_URL, { cache: "no-store" }),
        fetch(CONTEXT_URL, { cache: "no-store" }),
      ]);

      const list = await safeJson<TenantListResp>(listRes);
      if (!list.ok) throw new Error(list.message || list.error || "Failed to load tenants");

      const ctx = await safeJson<TenantContextResp>(ctxRes);
      if (!ctx.ok) throw new Error(ctx.message || ctx.error || "Failed to load tenant context");

      setTenants(list.tenants || []);
      setActiveTenantId(ctx.activeTenantId ?? null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setTenants([]);
      setActiveTenantId(null);
    } finally {
      setLoading(false);
    }
  }

  async function switchTenant(nextTenantId: string) {
    if (!nextTenantId || nextTenantId === activeTenantId) return;
    setSwitching(true);
    setError(null);

    try {
      const res = await fetch(CONTEXT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: nextTenantId }),
      });

      const data = await safeJson<any>(res);
      if (!data?.ok) throw new Error(data?.message || data?.error || "Failed to switch tenant");

      // force refresh so Server Components pick up new cookies
      window.location.reload();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setSwitching(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasMultiple = tenants.length > 1;

  const active = useMemo(
    () => tenants.find((t) => t.tenantId === activeTenantId) || null,
    [tenants, activeTenantId]
  );

  if (loading) {
    return (
      <div className={className}>
        <div className="text-xs text-gray-500 dark:text-gray-400">Loading tenant…</div>
      </div>
    );
  }

  if (!hasMultiple) {
    // still show active tenant label if we have one (nice touch)
    if (!active) return null;
    return (
      <div className={className}>
        <div className="hidden sm:flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs dark:border-gray-800 dark:bg-black">
          <span className="text-gray-500 dark:text-gray-400">Tenant</span>
          <span className="font-mono text-gray-900 dark:text-gray-100">
            {active.slug}
          </span>
        </div>
      </div>
    );
  }

  if (variant === "pills") {
    return (
      <div className={className}>
        <div className="flex flex-wrap items-center gap-1">
          {tenants.map((t) => {
            const isActive = t.tenantId === activeTenantId;
            return (
              <button
                key={t.tenantId}
                type="button"
                disabled={switching}
                onClick={() => switchTenant(t.tenantId)}
                className={[
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                  isActive
                    ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                    : "border-gray-200 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-200 dark:hover:bg-gray-900",
                  switching ? "opacity-60" : "",
                ].join(" ")}
                title={t.slug}
              >
                <span className="font-mono">{t.slug}</span>
                <span className="text-[10px] opacity-80">{t.role}</span>
              </button>
            );
          })}
        </div>
        {error ? (
          <div className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={className}>
      <label className="sr-only">Active Tenant</label>
      <select
        value={activeTenantId ?? ""}
        disabled={switching}
        onChange={(e) => switchTenant(e.target.value)}
        className="w-full sm:w-auto rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-black/20 disabled:opacity-60 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900 dark:focus:ring-white/20"
      >
        {tenants.map((t) => (
          <option key={t.tenantId} value={t.tenantId}>
            {t.name ? `${t.name} (${t.slug})` : t.slug} • {t.role}
          </option>
        ))}
      </select>

      {error ? (
        <div className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</div>
      ) : null}
    </div>
  );
}