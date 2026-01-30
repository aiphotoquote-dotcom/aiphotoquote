// src/components/tenant/AdminTenantGateShell.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

type TenantRow = {
  tenantId: string;
  slug: string;
  name: string | null;
  role: "owner" | "admin" | "member";
};

type ContextResp =
  | {
      ok: true;
      activeTenantId: string | null;
      tenants: TenantRow[];
      needsTenantSelection?: boolean;
      autoSelected?: boolean;
      clearedStaleCookie?: boolean;
    }
  | { ok: false; error: string; message?: string };

async function safeJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(`Expected JSON but got "${ct || "unknown"}" (status ${res.status}). ${text.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

/**
 * AdminTenantGateShell
 * - Ensures an active tenant is established before rendering /admin pages.
 * - Prevents child pages from calling tenant-gated APIs with no cookie (NO_ACTIVE_TENANT).
 * - If multiple tenants exist and none active, shows a selector.
 *
 * RBAC-ready: tenant rows already include role.
 */
export function AdminTenantGateShell({ children }: { children: React.ReactNode }) {
  const CONTEXT_URL = "/api/tenant/context";

  const [booting, setBooting] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);

  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  const activeTenant = useMemo(
    () => tenants.find((t) => t.tenantId === activeTenantId) || null,
    [tenants, activeTenantId]
  );

  async function loadContext() {
    // IMPORTANT: include credentials explicitly (removes any ambiguity)
    const res = await fetch(CONTEXT_URL, { cache: "no-store", credentials: "include" });
    const data = await safeJson<ContextResp>(res);
    if (!data.ok) throw new Error(data.message || data.error || "Failed to load tenant context");

    setTenants(Array.isArray(data.tenants) ? data.tenants : []);
    setActiveTenantId(data.activeTenantId ?? null);

    return data;
  }

  async function bootstrap() {
    setErr(null);
    setBooting(true);

    try {
      const ctx = await loadContext();

      // If context endpoint auto-selected (single tenant) it may have set cookies.
      // But to guarantee server + client are aligned, we hard-refresh once.
      if (ctx.ok && ctx.autoSelected) {
        window.location.reload();
        return;
      }
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBooting(false);
    }
  }

  async function switchTenant(tenantId: string) {
    if (!tenantId || tenantId === activeTenantId) return;

    setErr(null);
    setSwitchingTo(tenantId);

    try {
      const res = await fetch(CONTEXT_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tenantId }),
      });

      const data = await safeJson<any>(res);
      if (!data?.ok) throw new Error(data?.message || data?.error || "Failed to switch tenant");

      // Hard refresh is the most reliable way to make server components + route handlers
      // read the new cookie immediately on App Router.
      window.location.reload();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setSwitchingTo(null);
    }
  }

  useEffect(() => {
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ Gate: do not render admin pages until tenant is known-good
  if (booting) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-700 dark:border-gray-800 dark:bg-neutral-950 dark:text-gray-200">
          Initializing tenant…
        </div>
      </div>
    );
  }

  // Error state
  if (err) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10 space-y-3">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
          {err}
        </div>
        <button
          onClick={bootstrap}
          className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-neutral-950 dark:text-gray-100 dark:hover:bg-gray-900"
        >
          Retry
        </button>
      </div>
    );
  }

  // No tenants at all
  if (!tenants.length) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-5 text-sm text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-950/30 dark:text-yellow-100">
          No tenants found for this user yet.
        </div>
      </div>
    );
  }

  // Multiple tenants but none active → force selection
  if (!activeTenantId) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10 space-y-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-neutral-950">
          <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">Select a tenant</div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Your active tenant controls what quotes/settings you’re viewing.
          </div>

          <div className="mt-4 grid gap-2">
            {tenants.map((t) => {
              const isBusy = switchingTo === t.tenantId;
              return (
                <button
                  key={t.tenantId}
                  onClick={() => switchTenant(t.tenantId)}
                  disabled={isBusy}
                  className={cn(
                    "w-full rounded-xl border p-4 text-left transition",
                    "border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-black/30 dark:hover:bg-black/50",
                    isBusy ? "opacity-70" : ""
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {t.name || t.slug}{" "}
                        <span className="font-normal text-gray-500 dark:text-gray-400">({t.slug})</span>
                      </div>
                      <div className="mt-1 truncate text-[11px] font-mono text-gray-500 dark:text-gray-400">
                        {t.tenantId}
                      </div>
                    </div>
                    <span className="rounded-full border border-gray-200 px-2 py-1 text-[11px] font-mono text-gray-700 dark:border-gray-800 dark:text-gray-200">
                      {t.role}
                    </span>
                  </div>
                  {isBusy ? <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">Switching…</div> : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="text-xs text-gray-500 dark:text-gray-400">
          If you’re seeing this repeatedly, the cookie isn’t sticking — this gate forces a clean selection before any
          admin APIs run.
        </div>
      </div>
    );
  }

  // ✅ Happy path: tenant exists; render admin
  return (
    <div className="space-y-3">
      {/* tiny optional “tenant badge” — helps debug without opening switcher */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 dark:border-gray-800 dark:bg-black/30 dark:text-gray-200">
          <span className="inline-block h-2 w-2 rounded-full bg-green-600" />
          <span>
            Active tenant:{" "}
            <span className="font-mono">{activeTenant?.slug || activeTenantId.slice(0, 8)}</span>
          </span>
        </div>
      </div>

      {children}
    </div>
  );
}