// src/components/nav/NavShell.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { ReactNode, useMemo, useState } from "react";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export type NavLink = {
  key: string;
  href: string;
  label: string;
};

export type NavShellProps = {
  brandHref: string;
  brandLabel: string;

  links: NavLink[];

  // Decide which link is "active" based on current URL
  activeFromPath: (pathname: string) => string;

  // Optional right-side actions (desktop)
  rightSlot?: ReactNode;

  // Optional extra block shown in mobile menu (like sign-in buttons)
  mobileExtraSlot?: ReactNode;

  containerClassName?: string;
};

export default function NavShell({
  brandHref,
  brandLabel,
  links,
  activeFromPath,
  rightSlot,
  mobileExtraSlot,
  containerClassName,
}: NavShellProps) {
  const pathname = usePathname() || "";
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeKey = useMemo(() => activeFromPath(pathname), [pathname, activeFromPath]);

  const linkBase =
    "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors";
  const linkIdle =
    "text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-200 dark:hover:bg-gray-900 dark:hover:text-white";
  const linkActive = "bg-black text-white dark:bg-white dark:text-black";

  return (
    <header className="sticky top-0 z-30 w-full border-b border-gray-200 bg-white/80 backdrop-blur dark:border-gray-800 dark:bg-black/60">
      <div className={cn("mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3", containerClassName)}>
        <div className="flex items-center gap-3">
          <Link
            href={brandHref}
            className="flex items-center gap-2 rounded-lg px-2 py-1 font-semibold text-gray-900 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-900"
            onClick={() => setMobileOpen(false)}
          >
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-black dark:bg-white" />
            <span>{brandLabel}</span>
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

        <div className="flex items-center gap-2">
          {/* Desktop actions */}
          <div className="hidden sm:flex items-center gap-2">{rightSlot ?? null}</div>

          {/* Mobile menu toggle */}
          <button
            type="button"
            className="sm:hidden rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-900"
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

            {mobileExtraSlot ? <div className="mt-2">{mobileExtraSlot}</div> : null}
          </div>
        </div>
      ) : null}
    </header>
  );
}