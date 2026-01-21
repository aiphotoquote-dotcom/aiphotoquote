// src/components/admin/AdminTopNav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";
import { UserButton } from "@clerk/nextjs";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

type NavKey = "dashboard" | "quotes" | "settings" | "setup";

function activeFromPath(pathname: string): NavKey {
  const p = (pathname || "").toLowerCase();

  if (p === "/admin" || p.startsWith("/admin/")) {
    if (p.startsWith("/admin/quotes")) return "quotes";
    if (p.startsWith("/admin/settings")) return "settings";
    if (p.startsWith("/admin/setup")) return "setup";
    return "dashboard";
  }

  return "dashboard";
}

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
    throw new Error(
      `Expected JSON but got "${ct || "unknown"}" (status ${res.status}). First 80 chars: ${text.slice(0, 80)}`
    );
  }
  return (await res.json()) as T;
}

function TenantSwitcher({ compact }: { compact?: boolean }) {
  const [ctx, setCtx] = useState<{ activeTenantId: string | null; tenants: TenantRow[] }>({
    activeTenantId: null,
    tenants: [],
  });
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const active = useMemo(
    () => ctx.tenants.find((t) => t.tenantId === ctx.activeTenantId) || null,
    [ctx]
  );

  async function load() {
    setErr(null);
    try {
      const res = await fetch("/api/tenant/context", { cache: "no-store" });
      const data = await safeJson<ContextResp>(res);
      if (!data.ok) throw new Error(data.message || data.error || "Failed to load tenant context");
      setCtx({ activeTenantId: data.activeTenantId, tenants: data.tenants || [] });
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setCtx({ activeTenantId: null, tenants: [] });
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function switchTenant(tenantId: string) {
    setErr(null);
    setBusyId(tenantId);
    try {
      const res = await fetch("/api/tenant/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });
      const data = await safeJson<any>(res);
      if (!data?.ok) throw new Error(data?.message || data?.error || "Failed to switch tenant");

      // Refresh so server components + API calls read new cookies immediately
      window.location.reload();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setBusyId(null);
    }
  }

  // If only 0–1 tenants, don’t show the switch UI
  if ((ctx.tenants?.length || 0) <= 1) {
    return compact ? null : (
      <div className="hidden md:block text-xs text-gray-500 dark:text-gray-400">
        {active ? (
          <span>
            Tenant: <span className="font-mono">{active.slug}</span>
          </span>
        ) : (
          <span>No tenant</span>
        )}
      </div>
    );
  }

  const buttonCls =
    "inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900";
  const panelCls =
    "absolute right-0 mt-2 w-[min(420px,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-800 dark:bg-black";

  return (
    <div className={cn("relative", compact ? "w-full" : "")}>
      <button
        type="button"
        className={cn(buttonCls, compact ? "w-full justify-between" : "")}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="truncate">
          {active ? (
            <>
              <span className="text-gray-500 dark:text-gray-400">Tenant:</span>{" "}
              <span className="font-mono">{active.slug}</span>
            </>
          ) : (
            "Select tenant"
          )}
        </span>
        <span className="text-gray-500 dark:text-gray-400">{open ? "▲" : "▼"}</span>
      </button>

      {open ? (
        <div className={panelCls} role="dialog" aria-label="Tenant switcher">
          <div className="px-2 py-2">
            <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">
              Switch tenant
            </div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Changes apply immediately after reload.
            </div>
            {err ? (
              <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
                {err}
              </div>
            ) : null}
          </div>

          <div className="max-h-72 overflow-auto">
            {ctx.tenants.map((t) => {
              const isActive = t.tenantId === ctx.activeTenantId;
              const isBusy = busyId === t.tenantId;

              return (
                <button
                  key={t.tenantId}
                  type="button"
                  disabled={isBusy}
                  onClick={() => switchTenant(t.tenantId)}
                  className={cn(
                    "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                    isActive
                      ? "border-blue-300 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/30"
                      : "border-transparent hover:border-gray-200 hover:bg-gray-50 dark:hover:border-gray-800 dark:hover:bg-gray-950"
                  )}
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
                      {isBusy ? "…" : t.role}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex justify-end px-2 py-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function AdminTopNav() {
  const pathname = usePathname() || "";
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeKey = useMemo(() => activeFromPath(pathname), [pathname]);

  const linkBase =
    "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors";
  const linkIdle =
    "text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-200 dark:hover:bg-gray-900 dark:hover:text-white";
  const linkActive = "bg-black text-white dark:bg-white dark:text-black";

  const links: Array<{ key: NavKey; href: string; label: string }> = [
    { key: "dashboard", href: "/admin", label: "Dashboard" },
    { key: "quotes", href: "/admin/quotes", label: "Quotes" },
    { key: "settings", href: "/admin/settings", label: "Settings" },
    { key: "setup", href: "/admin/setup", label: "Setup" },
  ];

  return (
    <header className="sticky top-0 z-30 w-full border-b border-gray-200 bg-white/80 backdrop-blur dark:border-gray-800 dark:bg-black/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="flex items-center gap-2 rounded-lg px-2 py-1 font-semibold text-gray-900 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-900"
          >
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-black dark:bg-white" />
            <span>AI Photo Quote</span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {links.map((l) => (
              <Link
                key={l.key}
                href={l.href}
                className={cn(linkBase, activeKey === l.key ? linkActive : linkIdle)}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Right side: tenant switcher + account */}
        <div className="hidden md:flex items-center gap-3">
          <TenantSwitcher />
          <div className="rounded-lg border border-gray-200 bg-white px-2 py-1 dark:border-gray-800 dark:bg-black">
            {/* UserButton handles sign out + account switching */}
            <UserButton afterSignOutUrl="/" />
          </div>
        </div>

        {/* Mobile menu button */}
        <div className="flex items-center gap-2 md:hidden">
          <button
            type="button"
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-900"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-label="Toggle navigation"
          >
            Menu
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="md:hidden border-t border-gray-200 bg-white dark:border-gray-800 dark:bg-black">
          <div className="mx-auto max-w-6xl px-4 py-3 flex flex-col gap-2">
            <TenantSwitcher compact />

            <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-black">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Account</div>
              <UserButton afterSignOutUrl="/" />
            </div>

            <div className="mt-1 flex flex-col gap-1">
              {links.map((l) => (
                <Link
                  key={l.key}
                  href={l.href}
                  className={cn(linkBase, activeKey === l.key ? linkActive : linkIdle)}
                  onClick={() => setMobileOpen(false)}
                >
                  {l.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}