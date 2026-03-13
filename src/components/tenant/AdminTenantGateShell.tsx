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
 *
 * IMPORTANT:
 * - Do NOT perform tenant routing decisions here.
 * - Post-auth routing belongs in /auth/after-sign-in
 * - Server pages under /admin can enforce tenant requirements as needed
 *
 * Why:
 * - Client-side redirects from this shell caused existing users to be
 *   misrouted to /onboarding when tenant context had not fully settled yet.
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