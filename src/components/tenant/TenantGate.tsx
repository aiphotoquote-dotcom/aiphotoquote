// src/components/tenant/TenantGate.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type TenantRow = { tenantId: string; slug: string; name: string | null; role: "owner" | "admin" | "member" };

type ContextResp =
  | {
      ok: true;
      activeTenantId: string | null;
      tenants: TenantRow[];
      needsTenantSelection?: boolean;
      autoSelected?: boolean;
      error?: string;
      message?: string;
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
 * TenantGate ensures an active tenant is selected (cookie set) BEFORE rendering admin pages.
 * - If 1 tenant exists: /api/tenant/context auto-selects and sets cookie; we proceed.
 * - If multiple tenants: show picker; POST to set cookie; then reload.
 */
export default function TenantGate({
  children,
  title = "Select tenant",
  subtitle = "Choose which tenant you want to manage.",
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<{ activeTenantId: string | null; tenants: TenantRow[]; needsPick: boolean }>({
    activeTenantId: null,
    tenants: [],
    needsPick: false,
  });
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const active = useMemo(
    () => (ctx.activeTenantId ? ctx.tenants.find((t) => t.tenantId === ctx.activeTenantId) ?? null : null),
    [ctx.activeTenantId, ctx.tenants]
  );

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch("/api/tenant/context", { cache: "no-store" });
      const data = await safeJson<ContextResp>(res);
      if (!("ok" in data) || !data.ok) throw new Error((data as any)?.message || (data as any)?.error || "Failed.");

      const tenants = Array.isArray(data.tenants) ? data.tenants : [];
      const needsPick = !!data.needsTenantSelection;

      setCtx({
        activeTenantId: data.activeTenantId ?? null,
        tenants,
        needsPick,
      });

      // If API auto-selected (single tenant) or we already have an active tenant, we can proceed.
      if ((data.activeTenantId && !needsPick) || data.autoSelected) {
        // Ensure server components refresh with new cookie
        router.refresh();
      }
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setCtx({ activeTenantId: null, tenants: [], needsPick: false });
    } finally {
      setLoading(false);
    }
  }

  async function chooseTenant(tenantId: string) {
    const tid = String(tenantId || "").trim();
    if (!tid) return;

    setErr(null);
    setBusyId(tid);
    try {
      const res = await fetch("/api/tenant/context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: tid }),
      });
      const data = await safeJson<any>(res);
      if (!data?.ok) throw new Error(data?.message || data?.error || "Failed to set tenant.");

      // Hard reload so EVERYTHING reads new cookies immediately
      window.location.reload();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setBusyId(null);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If we have an active tenant and we're not forced to pick, render the admin page.
  if (!loading && ctx.activeTenantId && !ctx.needsPick) {
    return <>{children}</>;
  }

  // Otherwise show a safe gate UI
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-neutral-950">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</div>
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">{subtitle}</div>
          </div>

          <button
            onClick={load}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-neutral-950 dark:text-gray-100 dark:hover:bg-white/5"
            disabled={loading || !!busyId}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {err ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100">
            {err}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-6 text-sm text-gray-700 dark:text-gray-200">Checking tenant context…</div>
        ) : ctx.tenants.length === 0 ? (
          <div className="mt-6 rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-950/40 dark:text-yellow-100">
            No tenants found for this account.
          </div>
        ) : ctx.tenants.length === 1 ? (
          <div className="mt-6 text-sm text-gray-700 dark:text-gray-200">
            Selecting your tenant…{" "}
            <span className="text-gray-500 dark:text-gray-400">(If this doesn’t finish, hit Refresh.)</span>
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-2">
              {ctx.tenants.map((t) => (
                <button
                  key={t.tenantId}
                  type="button"
                  disabled={!!busyId}
                  onClick={() => chooseTenant(t.tenantId)}
                  className={cn(
                    "w-full rounded-xl border px-4 py-3 text-left transition-colors",
                    "border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-white/5",
                    busyId === t.tenantId ? "opacity-70" : ""
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-gray-900 dark:text-gray-100">
                        {t.name || t.slug}{" "}
                        <span className="font-normal text-gray-500 dark:text-gray-400">({t.slug})</span>
                      </div>
                      <div className="mt-0.5 truncate text-xs font-mono text-gray-500 dark:text-gray-400">
                        {t.tenantId}
                      </div>
                    </div>
                    <div className="shrink-0 text-xs font-mono text-gray-600 dark:text-gray-300">
                      {busyId === t.tenantId ? "…" : t.role}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {active ? (
              <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                Active: <span className="font-mono">{active.slug}</span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}