// src/components/admin/AdminTopNav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useMemo, useState } from "react";
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

export default function AdminTopNav() {
  const pathname = usePathname() || "";
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeKey = useMemo(() => activeFromPath(pathname), [pathname]);

  const linkBase =
    "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors";
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

        {/* Right: tenant switcher + account (desktop) */}
        <div className="hidden md:flex items-center gap-3">
          <AdminTenantSwitcher />
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
            {/* account */}
            <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white/70 px-3 py-2 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-black/30">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Account</div>
              <UserButton afterSignOutUrl="/" />
            </div>

            {/* links */}
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