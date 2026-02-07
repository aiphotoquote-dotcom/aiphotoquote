// src/components/admin/AdminTopNav.tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { UserButton } from "@clerk/nextjs";

import AdminTenantSwitcher from "@/components/admin/AdminTenantSwitcher";

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

type TenantRow = { tenantId: string; slug: string; name: string | null; role: string };
type TenantContextResp =
  | {
      ok: true;
      activeTenantId: string | null;
      tenants: TenantRow[];
      needsTenantSelection?: boolean;
      autoSelected?: boolean;
      clearedStaleCookie?: boolean;
    }
  | { ok: false; error: string; message?: string };

function Pill(props: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" }) {
  const tone = props.tone ?? "neutral";
  const cls =
    tone === "good"
      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-200"
      : tone === "warn"
      ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-900/20 dark:text-yellow-100"
      : "border-gray-200 bg-white/70 text-gray-700 dark:border-gray-800 dark:bg-black/30 dark:text-gray-200";

  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold", cls)}>
      {props.children}
    </span>
  );
}

function hardReloadSamePage() {
  try {
    const next = `${window.location.pathname}${window.location.search}${window.location.hash || ""}`;
    window.location.assign(next);
  } catch {
    window.location.reload();
  }
}

export default function AdminTopNav() {
  const router = useRouter();
  const pathname = usePathname() || "";
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeKey = useMemo(() => activeFromPath(pathname), [pathname]);

  const linkBase = "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors";
  const linkIdle =
    "text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-200 dark:hover:bg-white/5 dark:hover:text-white";
  const linkActive = "bg-gray-900 text-white shadow-sm dark:bg-white dark:text-black";

  const links: Array<{ key: NavKey; href: string; label: string }> = [
    { key: "dashboard", href: "/admin", label: "Dashboard" },
    { key: "quotes", href: "/admin/quotes", label: "Quotes" },
    { key: "settings", href: "/admin/settings", label: "Settings" },
    { key: "setup", href: "/admin/setup", label: "AI Setup" },
    { key: "widgets", href: "/admin/setup/widget", label: "Widgets" },
  ];

  // ---- Tenant context ----
  const [ctx, setCtx] = useState<TenantContextResp | null>(null);
  const [ctxLoading, setCtxLoading] = useState(true);

  const loadContext = useCallback(async () => {
    setCtxLoading(true);
    try {
      const res = await fetch("/api/tenant/context", {
        cache: "no-store",
        credentials: "include", // ✅ important for consistent cookie behavior
      });

      const data = (await res.json().catch(() => null)) as TenantContextResp | null;
      setCtx(data ?? { ok: false, error: "BAD_RESPONSE", message: "Invalid tenant context response" });
    } catch (e: any) {
      setCtx({ ok: false, error: "CONTEXT_FETCH_FAILED", message: e?.message ?? String(e) });
    } finally {
      setCtxLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadContext();
  }, [loadContext]);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Refresh tenant context on route change (keeps nav pill aligned while browsing)
  useEffect(() => {
    loadContext();
  }, [pathname, loadContext]);

  // Refresh tenant context when the tab becomes active again
  useEffect(() => {
    function onFocus() {
      loadContext();
    }
    function onVis() {
      if (document.visibilityState === "visible") loadContext();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [loadContext]);

  // Allow ANY component to request a context refresh:
  // window.dispatchEvent(new Event("apq:tenant-changed"))
  useEffect(() => {
    function onTenantChanged() {
      // reload context + refresh server components (reads new cookie)
      loadContext().catch(() => null);
      router.refresh();

      // ✅ HARDENING: guarantee all admin pages reflect new tenant immediately
      // (iOS/Safari can be sticky with app-router caches)
      hardReloadSamePage();
    }
    window.addEventListener("apq:tenant-changed", onTenantChanged as any);
    return () => {
      window.removeEventListener("apq:tenant-changed", onTenantChanged as any);
    };
  }, [loadContext, router]);

  const activeTenant =
    ctx && "ok" in ctx && ctx.ok && ctx.activeTenantId
      ? (ctx.tenants || []).find((t) => t.tenantId === ctx.activeTenantId) ?? null
      : null;

  const shouldShowSwitcher =
    !ctxLoading && ctx && "ok" in ctx && ctx.ok && Array.isArray(ctx.tenants) && ctx.tenants.length > 0;

  return (
    <header className="sticky top-0 z-30 w-full border-b border-gray-200 bg-white/70 backdrop-blur dark:border-gray-800 dark:bg-neutral-950/70">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        {/* Left: Brand + desktop nav */}
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
              <Link key={l.key} href={l.href} className={cn(linkBase, activeKey === l.key ? linkActive : linkIdle)}>
                {l.label}
              </Link>
            ))}
          </nav>

          {/* Tenant pill (desktop) */}
          <div className="hidden md:flex items-center">
            {ctxLoading ? (
              <Pill>Tenant: …</Pill>
            ) : activeTenant ? (
              <Pill tone="good">
                Tenant: <span className="ml-1 font-mono">{activeTenant.slug}</span>
              </Pill>
            ) : (
              <Pill tone="warn">Tenant: none</Pill>
            )}
          </div>
        </div>

        {/* Right: tenant switcher + account (desktop) */}
        <div className="hidden md:flex items-center gap-3">
          {shouldShowSwitcher ? <AdminTenantSwitcher /> : null}

          <div className="rounded-xl border border-gray-200 bg-white/70 px-2 py-1 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-black/30">
            <UserButton afterSignOutUrl="/" />
          </div>
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
            {/* Tenant (mobile): pill + switcher */}
            <div className="rounded-xl border border-gray-200 bg-white/70 px-3 py-3 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-black/30">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Tenant</div>
                {ctxLoading ? (
                  <Pill>…</Pill>
                ) : activeTenant ? (
                  <Pill tone="good">
                    <span className="font-mono">{activeTenant.slug}</span>
                  </Pill>
                ) : (
                  <Pill tone="warn">none</Pill>
                )}
              </div>

              {/* ✅ Mobile switcher: AdminTenantSwitcher renders native <select> on small screens */}
              <div className="mt-3">{shouldShowSwitcher ? <AdminTenantSwitcher /> : null}</div>
            </div>

            {/* account */}
            <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white/70 px-3 py-2 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-black/30">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Account</div>
              <UserButton afterSignOutUrl="/" />
            </div>

            {/* links */}
            <div className="mt-1 flex flex-col gap-1">
              {links.map((l) => (
                <Link key={l.key} href={l.href} className={cn(linkBase, activeKey === l.key ? linkActive : linkIdle)}>
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