// src/components/admin/AdminTopNav.tsx
"use client";

import React, { useCallback } from "react";
import { UserButton } from "@clerk/nextjs";
import NavShell, { type NavLink } from "@/components/nav/NavShell";
import AdminTenantSwitcher from "@/components/admin/AdminTenantSwitcher";

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

  const active = useCallback((p: string) => activeFromPath(p), []);

  return (
    <NavShell
      brandHref="/admin"
      brandLabel="AI Photo Quote"
      links={links}
      activeFromPath={active}
      rightSlot={
        <div className="flex items-center gap-2">
          <AdminTenantSwitcher />
          <div className="rounded-lg border border-gray-200 bg-white px-2 py-1 dark:border-gray-800 dark:bg-black">
            <UserButton
              afterSignOutUrl="/"
              appearance={{
                elements: {
                  avatarBox: "h-7 w-7",
                },
              }}
            />
          </div>
        </div>
      }
      mobileExtraSlot={
        <div className="flex items-center justify-between gap-2">
          <AdminTenantSwitcher />
          <div className="rounded-lg border border-gray-200 bg-white px-2 py-1 dark:border-gray-800 dark:bg-black">
            <UserButton
              afterSignOutUrl="/"
              appearance={{
                elements: {
                  avatarBox: "h-7 w-7",
                },
              }}
            />
          </div>
        </div>
      }
    />
  );
}
