// src/app/admin/layout.tsx
"use client";

import React, { ReactNode, useEffect, useState } from "react";
import { RedirectToSignIn, useAuth } from "@clerk/nextjs";

import AdminTopNav from "@/components/admin/AdminTopNav";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { isLoaded, userId } = useAuth();
  const [bootstrapped, setBootstrapped] = useState(false);

  // While Clerk is loading, render a lightweight shell (prevents flicker + errors)
  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-neutral-950 dark:text-gray-100">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <div className="text-sm text-gray-600 dark:text-gray-300">Loading…</div>
        </div>
      </div>
    );
  }

  // Not signed in → go sign in
  if (!userId) {
    return <RedirectToSignIn />;
  }

  // Bootstrap tenant cookies on first load (new device / cleared cookies)
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        await fetch("/api/tenant/context", { cache: "no-store" });
      } catch {
        // ignore; we’ll let child pages show errors if needed
      } finally {
        if (!cancelled) setBootstrapped(true);
      }
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  // Wait until the cookie bootstrap has run at least once.
  // This prevents tenant-dependent client code from firing instantly into a missing-cookie state.
  if (!bootstrapped) {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-neutral-950 dark:text-gray-100">
        <AdminTopNav />
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <div className="text-sm text-gray-600 dark:text-gray-300">Initializing tenant…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-neutral-950 dark:text-gray-100">
      <AdminTopNav />
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</div>
    </div>
  );
}