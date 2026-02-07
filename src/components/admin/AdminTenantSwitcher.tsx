// src/components/admin/AdminTenantSwitcher.tsx
"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

type TenantRow = {
  tenantId: string;
  slug: string;
  name: string | null;
  role: "owner" | "admin" | "member";
};

type ContextResp =
  | { ok: true; activeTenantId: string | null; tenants: TenantRow[] }
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

type Props = {
  /**
   * button: existing dropdown button UI (desktop)
   * select: native <select> (mobile-friendly)
   */
  variant?: "button" | "select";
  className?: string;
};

export default function AdminTenantSwitcher({ variant = "button", className }: Props) {
  const router = useRouter();
  const pathname = usePathname() || "";
  const [isPending, startTransition] = useTransition();

  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // dropdown state for button variant
  const [open, setOpen] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  const CONTEXT_URL = "/api/tenant/context";

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch(CONTEXT_URL, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });

      const data = await safeJson<ContextResp>(res);
      if (!data.ok) throw new Error((data as any).message || (data as any).error || "Failed to load tenant context");

      setTenants(Array.isArray(data.tenants) ? data.tenants : []);
      setActiveTenantId(data.activeTenantId ?? null);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setTenants([]);
      setActiveTenantId(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeTenant = useMemo(
    () => tenants.find((t) => t.tenantId === activeTenantId) || null,
    [tenants, activeTenantId]
  );

  const show = tenants.length > 1;
  if (!show) return null;

  function dispatchTenantChanged() {
    try {
      window.dispatchEvent(new Event("apq:tenant-changed"));
    } catch {
      // ignore
    }
  }

  function hardReloadSameUrl() {
    // iOS/Safari/Chrome can be stubborn with RSC refresh; this guarantees the new cookie is used.
    try {
      window.location.assign(window.location.href);
    } catch {
      // ignore
    }
  }

  async function switchTenant(tenantId: string) {
    if (!tenantId || tenantId === activeTenantId) {
      setOpen(false);
      return;
    }

    setErr(null);
    setSwitchingTo(tenantId);

    // Optimistic UI update
    const prev = activeTenantId;
    setActiveTenantId(tenantId);

    try {
      const res = await fetch(CONTEXT_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId }),
        credentials: "include",
        cache: "no-store",
      });

      const data = await safeJson<any>(res);
      if (!data?.ok) throw new Error(data?.message || data?.error || "Failed to switch tenant");

      setOpen(false);

      // Let listeners update pills, etc.
      dispatchTenantChanged();

      // Ask Next to re-fetch server components
      startTransition(() => {
        router.refresh();
      });

      // Keep switcher truthful
      await load();

      // 🔥 iOS hardening: if we stayed on the same route, force a full reload to eliminate stale RSC payloads
      // This is what fixes "dashboard correct but quotes list old tenant remnant" on mobile.
      if (pathname.startsWith("/admin")) {
        hardReloadSameUrl();
      }
    } catch (e: any) {
      setActiveTenantId(prev ?? null);
      await load();
      setErr(e?.message ?? String(e));
    } finally {
      setSwitchingTo(null);
    }
  }

  // ---------- SELECT (mobile-friendly) ----------
  if (variant === "select") {
    return (
      <div className={cn("w-full", className)}>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Tenant</div>
          <span className="rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-800 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-200">
            {activeTenant?.slug || "(none)"}
          </span>
        </div>

        <div className="mt-3">
          <select
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm font-semibold text-gray-900 shadow-sm dark:border-gray-800 dark:bg-black dark:text-gray-100"
            value={activeTenantId ?? ""}
            disabled={loading || !!switchingTo}
            onChange={(e) => switchTenant(e.target.value)}
            aria-label="Select tenant"
          >
            <option value="" disabled>
              Select tenant…
            </option>
            {tenants.map((t) => (
              <option key={t.tenantId} value={t.tenantId}>
                {t.slug}
              </option>
            ))}
          </select>

          {isPending ? <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">Updating views…</div> : null}
          {err ? <div className="mt-2 text-sm text-red-700 dark:text-red-300">{err}</div> : null}
        </div>
      </div>
    );
  }

  // ---------- BUTTON (desktop) ----------
  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold",
          "text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900"
        )}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Tenant switcher"
      >
        <span className="inline-block h-2 w-2 rounded-full bg-green-600" />
        <span className="hidden sm:inline">Tenant:</span>
        <span className="font-mono text-xs sm:text-sm">{loading ? "Loading…" : activeTenant?.slug || "(none)"}</span>
        <span className="text-xs opacity-70">▾</span>
      </button>

      {open ? (
        <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-800 dark:bg-black">
          <div className="border-b border-gray-200 p-3 dark:border-gray-800">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Switch tenant</div>
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              Your active tenant controls what quotes/settings you’re viewing.
            </div>
            {isPending ? <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">Updating views…</div> : null}
          </div>

          <div className="max-h-80 overflow-auto p-2">
            {tenants.map((t) => {
              const isActive = t.tenantId === activeTenantId;
              const isBusy = switchingTo === t.tenantId;

              return (
                <button
                  key={t.tenantId}
                  type="button"
                  onClick={() => switchTenant(t.tenantId)}
                  className={cn(
                    "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                    isActive
                      ? "border-blue-400 bg-blue-50 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-100"
                      : "border-gray-200 bg-white text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900"
                  )}
                  disabled={isBusy || loading}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">
                        {t.name || t.slug}{" "}
                        <span className="font-normal text-gray-500 dark:text-gray-400">({t.slug})</span>
                      </div>
                      <div className="mt-1 truncate text-[11px] font-mono text-gray-500 dark:text-gray-400">
                        {t.tenantId}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-gray-200 px-2 py-1 text-[11px] font-mono text-gray-700 dark:border-gray-800 dark:text-gray-200">
                        {t.role}
                      </span>
                      {isActive ? (
                        <span className="rounded-full bg-black px-2 py-1 text-[11px] font-semibold text-white dark:bg-white dark:text-black">
                          Active
                        </span>
                      ) : isBusy ? (
                        <span className="text-[11px] text-gray-500 dark:text-gray-400">Switching…</span>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {err ? (
            <div className="border-t border-gray-200 p-3 text-sm text-red-700 dark:border-gray-800 dark:text-red-300">
              {err}
            </div>
          ) : null}

          <div className="flex justify-end border-t border-gray-200 p-2 dark:border-gray-800">
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-900"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}