// src/components/tenant/AdminTenantGateShell.tsx
"use client";

import React from "react";
import { usePathname } from "next/navigation";

import AdminTopNav from "@/components/admin/AdminTopNav";

/**
 * AdminTenantGateShell
 *
 * Purpose:
 * - Wraps all /admin pages
 * - Provides consistent top navigation
 * - Ensures tenant context is established before rendering children
 *
 * NOTE:
 * - Any tenant debug UI has been intentionally removed
 * - Tenant visibility is now handled exclusively via:
 *   - AdminTopNav (read-only)
 *   - AdminTenantSwitcher (authoritative)
 */
export default function AdminTenantGateShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // Allow auth + onboarding routes to render without admin chrome
  if (
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
    pathname.startsWith("/onboarding")
  ) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-neutral-950">
      <AdminTopNav />
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}