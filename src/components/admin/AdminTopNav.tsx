// src/components/admin/AdminTopNav.tsx
"use client";

import React, { useCallback } from "react";
import NavShell, { type NavLink } from "@/components/nav/NavShell";

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

export default function AdminTopNav() {
  const links: NavLink[] = [
    { key: "dashboard", href: "/admin", label: "Dashboard" },
    { key: "quotes", href: "/admin/quotes", label: "Quotes" },
    { key: "settings", href: "/admin/settings", label: "Settings" },
    { key: "setup", href: "/admin/setup", label: "Setup" },
  ];

  // memo-safe callback so NavShell's useMemo doesn't churn
  const active = useCallback((p: string) => activeFromPath(p), []);

  return (
    <NavShell
      brandHref="/admin"
      brandLabel="AI Photo Quote"
      links={links}
      activeFromPath={active}
    />
  );
}