// src/components/admin/AdminTopNav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

type NavKey = "dashboard" | "quotes" | "settings" | "setup";

function activeFromPath(pathname: string): NavKey {
  const p = (pathname || "").toLowerCase();

  // Admin area
  if (p === "/admin" || p.startsWith("/admin/")) {
    if (p.startsWith("/admin/quotes")) return "quotes";
    if (p.startsWith("/admin/settings")) return "settings";
    if (p.startsWith("/admin/setup")) return "setup";
    return "dashboard";
  }

  return "dashboard";
}

const LINKS = [
  { key: "dashboard", href: "/admin", label: "Dashboard" },
  { key: "quotes", href: "/admin/quotes", label: "Quotes" },
  { key: "settings", href: "/admin/settings", label: "Settings" },
  { key: "setup", href: "/admin/setup", label: "Setup" },
] as const satisfies ReadonlyArray<{ key: NavKey; href: string; label: string }>;

export default function AdminTopNav() {
  const pathname = usePathname() || "";
  const [mobileOpen, setMobileOpen] = useState(false);

  // Force the memo result to the union type to avoid any accidental narrowing.
  const activeKey: NavKey = useMemo(() => activeFromPath(pathname), [pathname]);

  // Close menu on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const linkBase =
    "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors";
  const linkIdle =
    "text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-200 dark:hover:bg-gray-900 dark:hover:text-white";
  const linkActive = "bg-black text-white dark:bg-white dark:text-black";

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
            {LINKS.map((l) => (
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

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="md:hidden rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-900"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-label="Toggle navigation"
          >
            Menu
          </button>
        </div>
      </div>

      {mobileOpen ? (
        <div className="md:hidden border-t border-gray-200 bg-white dark:border-gray-800 dark:bg-black">
          <div className="mx-auto max-w-6xl px-4 py-3 flex flex-col gap-1">
            {LINKS.map((l) => (
              <Link
                key={l.key}
                href={l.href}
                className={cn(linkBase, activeKey === l.key ? linkActive : linkIdle)}
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </header>
  );
}