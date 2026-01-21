// src/components/marketing/MarketingTopNav.tsx
"use client";

import Link from "next/link";
import React, { useCallback } from "react";
import NavShell, { type NavLink } from "@/components/nav/NavShell";

type MarketingKey = "home" | "demo" | "pricing" | "docs";

function activeFromPath(pathname: string): MarketingKey {
  const p = (pathname || "").toLowerCase();
  if (p === "/" || p === "/home") return "home";
  if (p.startsWith("/q/")) return "demo";
  if (p.startsWith("/pricing")) return "pricing";
  if (p.startsWith("/docs")) return "docs";
  return "home";
}

export default function MarketingTopNav() {
  const links: NavLink[] = [
    { key: "home", href: "/", label: "Home" },
    { key: "demo", href: "/q/demo", label: "Demo" },
    // remove these two until you create pages if you want to avoid 404 clicks
    { key: "pricing", href: "/pricing", label: "Pricing" },
    { key: "docs", href: "/docs", label: "Docs" },
  ];

  const active = useCallback((p: string) => activeFromPath(p), []);

  return (
    <NavShell
      brandHref="/"
      brandLabel="AI Photo Quote"
      links={links}
      activeFromPath={active}
      rightSlot={
        <>
          <Link
            href="/sign-in"
            className="inline-flex rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-900"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex rounded-lg bg-black px-3 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
          >
            Get started
          </Link>
        </>
      }
      mobileExtraSlot={
        <div className="grid grid-cols-2 gap-2">
          <Link
            href="/sign-in"
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-900 text-center"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-lg bg-black px-3 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black text-center"
          >
            Get started
          </Link>
        </div>
      }
    />
  );
}