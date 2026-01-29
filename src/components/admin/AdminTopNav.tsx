// src/components/admin/AdminTopNav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { SignedIn, SignedOut, UserButton, useAuth } from "@clerk/nextjs";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

type NavKey = "dashboard" | "quotes" | "settings" | "setup" | "widgets";

function activeFromPath(pathname: string): NavKey {
  const p = (pathname || "").toLowerCase();

  if (p === "/admin" || p.startsWith("/admin/")) {
    if (p.startsWith("/admin/quotes")) return "quotes";
    if (p.startsWith("/admin/settings")) return "settings";
    if (p.startsWith("/admin/setup/widget")) return "widgets";
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
  const { isLoaded, isSignedIn } = useAuth();

  const [ctx, setCtx] = useState<{ activeTenantId: string | null; tenants: TenantRow[] }>({
    activeTenantId: null,
    tenants: [],
  });
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);

  const active = useMemo(
    () => ctx.tenants.find((t) => t.tenantId === ctx.activeTenantId) || null,
    [ctx]
  );

  // Load only after Clerk is ready + user is signed in (prevents hydration-time crashes)
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    let cancelled = false;

    (async () => {
      setErr(null);
      try {
        const res = await fetch("/api/tenant/context", { cache: "no-store" });
        const data = await safeJson<ContextResp>(res);
        if (cancelled) return;

        if (!data.ok) throw new Error(data.message || data.error || "Failed to load tenant context");
        setCtx({ activeTenantId: data.activeTenantId, tenants: data.tenants || [] });
      } catch (e: any) {
        if (cancelled) return;
        setErr(e?.message ?? String(e));
        setCtx({ activeTenantId: null, tenants: [] });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn]);

  // Close on click outside
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!open) return;
      const el = rootRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

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

  // While Clerk is booting, keep UI stable (no fetches, no crashes)
  if (!isLoaded) {
    return compact ? null : (
      <div className="hidden md:flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
        <span className="inline-flex h-2 w-2 rounded-full bg-gray-400/80" />
        <span>Loading…</span>
      </div>
    );
  }

  // Not signed in (should be rare inside /admin, but safe)
  if (!isSignedIn) return null;

  // If only 0–1 tenants, don’t show the switch UI
  if ((ctx.tenants?.length || 0) <= 1) {
    return compact ? null : (
      <div className="hidden md:flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
        <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500/80" />
        {active ? (
          <span>
            Tenant <span className="text-gray-400 dark:text-gray-500">•</span>{" "}
            <span className="font-mono">{active.slug}</span>
          </span>
        ) : (
          <span>No tenant</span>
        )}
      </div>
    );
  }

  const buttonCls =
    "inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm backdrop-blur hover:bg-white dark:border-gray-800 dark:bg-black/40 dark:text-gray-100 dark:hover:bg-black/60";
  const panelCls =
    "absolute right-0 mt-2 w-[min(460px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl ring-1 ring-black/5 dark:border-gray-800 dark:bg-neutral-950 dark:ring-white/10";

  return (
    <div ref={rootRef} className={cn("relative", compact ? "w-full" : "")}>
      <button
        type="button"
        className={cn(buttonCls, compact ? "w-full justify-between" : "")}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="min-w-0 truncate">
          {active ? (
            <>
              <span className="text-gray-500 dark:text-gray-400">Tenant</span>{" "}
              <span className="text-gray-400 dark:text-gray-500">•</span>{" "}
              <span className="font-mono">{active.slug}</span>
            </>
          ) : (
            "Select tenant"
          )}
        </span>
        <span className="shrink-0 text-gray-500 dark:text-gray-400">{open ? "▲" : "▼"}</span>
      </button>

      {open ? (
        <div className={panelCls} role="dialog" aria-label="Tenant switcher">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-900">
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Switch tenant</div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Changes apply immediately after reload.
            </div>

            {err ? (
              <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
                {err}
              </div>
            ) : null}
          </div>

          <div className="max-h-80 overflow-auto p-2">
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
                    "w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                    isActive
                      ? "border-blue-300 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/30"
                      : "border-transparent hover:border-gray-200 hover:bg-gray-50 dark:hover:border-gray-800 dark:hover:bg-white/5"
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

                    <div className="shrink-0 flex items-center gap-2">
                      {isActive ? (
                        <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200">
                          Active
                        </span>
                      ) : null}
                      <span className="text-xs font-mono text-gray-600 dark:text-gray-300">
                        {isBusy ? "…" : t.role}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-100 dark:border-gray-900">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-neutral-950 dark:text-gray-100 dark:hover:bg-white/5"
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
    "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors";
  const linkIdle =
    "text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-200 dark:hover:bg-white/5 dark:hover:text-white";
  const linkActive = "bg-gray-900 text-white shadow-sm dark:bg-white dark:text-black";

  // NOTE: No LLM Manager link here (by design). We'll link to it from /admin/setup page.
  const links: Array<{ key: NavKey; href: string; label: string }> = [
    { key: "dashboard", href: "/admin", label: "Dashboard" },
    { key: "quotes", href: "/admin/quotes", label: "Quotes" },
    { key: "settings", href: "/admin/settings", label: "Settings" },
    { key: "setup", href: "/admin/setup", label: "AI Setup" },
    { key: "widgets", href: "/admin/setup/widget", label: "Widgets" },
  ];

  return (
    <header className="sticky top-0 z-30 w-full border-b border-gray-200 bg-white/70 backdrop-blur dark:border-gray-800 dark:bg-neutral-950/70">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="group flex items-center gap-2 rounded-xl px-2 py-1 font-semibold text-gray-900 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-white/5"
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-900 shadow-sm dark:border-gray-800 dark:bg-neutral-950 dark:text-gray-100">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-900 dark:bg-white" />
            </span>
            <span className="tracking-tight">AI Photo Quote</span>
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
          <SignedIn>
            <TenantSwitcher />
            <div className="rounded-xl border border-gray-200 bg-white/70 px-2 py-1 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-black/30">
              <UserButton afterSignOutUrl="/" />
            </div>
          </SignedIn>

          <SignedOut>
            <Link
              href="/sign-in"
              className="rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm font-semibold text-gray-800 shadow-sm backdrop-blur hover:bg-white dark:border-gray-800 dark:bg-black/30 dark:text-gray-200 dark:hover:bg-black/50"
            >
              Sign in
            </Link>
          </SignedOut>
        </div>

        {/* Mobile menu button */}
        <div className="flex items-center gap-2 md:hidden">
          <button
            type="button"
            className="rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm font-semibold text-gray-800 shadow-sm backdrop-blur hover:bg-white dark:border-gray-800 dark:bg-black/30 dark:text-gray-200 dark:hover:bg-black/50"
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
        <div className="md:hidden border-t border-gray-200 bg-white/80 backdrop-blur dark:border-gray-800 dark:bg-neutral-950/80">
          <div className="mx-auto max-w-6xl px-4 py-3 flex flex-col gap-2">
            <SignedIn>
              <TenantSwitcher compact />

              <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white/70 px-3 py-2 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-black/30">
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
            </SignedIn>

            <SignedOut>
              <Link
                href="/sign-in"
                className="rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-sm font-semibold text-gray-800 shadow-sm backdrop-blur hover:bg-white dark:border-gray-800 dark:bg-black/30 dark:text-gray-200 dark:hover:bg-black/50"
                onClick={() => setMobileOpen(false)}
              >
                Sign in
              </Link>
            </SignedOut>
          </div>
        </div>
      ) : null}
    </header>
  );
}