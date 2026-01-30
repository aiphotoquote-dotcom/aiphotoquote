// src/components/tenant/TenantGate.tsx
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
    throw new Error(
      `Expected JSON but got "${ct || "unknown"}" (status ${res.status}). First 120 chars: ${text.slice(0, 120)}`
    );
  }
  return (await res.json()) as T;
}

export function TenantGate(props: {
  children: React.ReactNode;
  /**
   * When true, shows a full-page gate while selecting a tenant.
   * When false, shows a small inline gate (good for embedding).
   */
  fullPage?: boolean;
}) {
  const fullPage = props.fullPage ?? true;

  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<{ activeTenantId: string | null; tenants: TenantRow[] }>({
    activeTenantId: null,
    tenants: [],
  });
  const [err, setErr] = useState<string | null>(null);
  const [busyTenantId, setBusyTenantId] = useState<string | null>(null);

  const needsSelection = useMemo(() => {
    if (loading) return true;
    // needs selection if: no active tenant and there are multiple tenants
    return !ctx.activeTenantId && (ctx.tenants?.length ?? 0) > 0;
  }, [loading, ctx]);

  async function loadContext() {
    const res = await fetch("/api/tenant/context", { cache: "no-store" });
    const data = await safeJson<ContextResp>(res);
    if (!data.ok) throw new Error(data.message || data.error || "Failed to load tenant context");

    const tenants = Array.isArray(data.tenants) ? data.tenants : [];
    setCtx({ activeTenantId: data.activeTenantId ?? null, tenants });

    // If there is exactly one tenant but we still don't have an active tenant,
    // force-set via POST (this avoids edge cases where a Set-Cookie from GET
    // doesn't persist before the next API call).
    if (!data.activeTenantId && tenants.length === 1) {
      await forceSelect(tenants[0].tenantId, { reload: true });
      return;
    }
  }

  async function forceSelect(
    tenantId: string,
    opts?: { reload?: boolean }
  ) {
    setBusyTenantId(tenantId);
    setErr(null);

    try {
      const res = await fetch("/api/tenant/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });

      const data = await safeJson<any>(res);
      if (!data?.ok) throw new Error(data?.message || data?.error || "Failed to set active tenant");

      // Hard reload ensures *all* server components + route handlers read fresh cookies.
      if (opts?.reload !== false) {
        window.location.reload();
        return;
      }

      // Soft refresh state (rarely used)
      setCtx((prev) => ({ ...prev, activeTenantId: tenantId }));
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setBusyTenantId(null);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      setLoading(true);
      setErr(null);

      try {
        await loadContext();
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    boot();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If we have an active tenant, render the app immediately.
  if (!loading && ctx.activeTenantId) {
    return <>{props.children}</>;
  }

  // While loading, or if we need selection, show a gate.
  const Shell = ({ children }: { children: React.ReactNode }) =>
    fullPage ? (
      <div className="min-h-[70vh] w-full px-6 py-12">
        <div className="mx-auto max-w-xl">{children}</div>
      </div>
    ) : (
      <div className="w-full">{children}</div>
    );

  return (
    <Shell>
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {loading ? "Loading tenant…" : "Select a tenant"}
        </div>

        <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          {loading
            ? "Preparing your workspace."
            : "Your account has access to multiple tenants. Choose which one to manage."}
        </div>

        {err ? (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
            {err}
          </div>
        ) : null}

        {!loading && (ctx.tenants?.length ?? 0) === 0 ? (
          <div className="mt-4 text-sm text-gray-700 dark:text-gray-200">
            No tenants found for this user.
          </div>
        ) : null}

        {!loading && !ctx.activeTenantId && (ctx.tenants?.length ?? 0) > 0 ? (
          <div className="mt-4 grid gap-2">
            {ctx.tenants.map((t) => {
              const busy = busyTenantId === t.tenantId;
              return (
                <button
                  key={t.tenantId}
                  type="button"
                  disabled={!!busyTenantId}
                  onClick={() => forceSelect(t.tenantId, { reload: true })}
                  className={[
                    "w-full rounded-xl border px-3 py-3 text-left transition-colors",
                    "border-gray-200 bg-white hover:bg-gray-50",
                    "dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900",
                    busy ? "opacity-70" : "",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-gray-900 dark:text-gray-100">
                        {t.name || t.slug}{" "}
                        <span className="font-normal text-gray-500 dark:text-gray-400">
                          ({t.slug})
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-xs font-mono text-gray-500 dark:text-gray-400">
                        {t.tenantId}
                      </div>
                    </div>
                    <div className="shrink-0 text-xs font-mono text-gray-600 dark:text-gray-300">
                      {busy ? "…" : t.role}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}

        {!loading ? (
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
            >
              Refresh
            </button>
          </div>
        ) : null}
      </div>
    </Shell>
  );
}