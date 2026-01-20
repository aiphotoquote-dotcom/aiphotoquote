// src/app/admin/page.tsx
"use client";

import Link from "next/link";
import React, { useMemo } from "react";

// NOTE: import this from wherever you currently pull it.
// If your file already has this import, keep it exactly the same and delete this line.
import { useTenantContext } from "@/components/TenantProvider";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function AdminHome() {
  const context = useTenantContext();

  // ✅ Guard: context.tenants can be undefined during first render / fetch.
  const tenants = useMemo(() => (Array.isArray(context?.tenants) ? context.tenants : []), [context?.tenants]);

  const activeTenant = useMemo(() => {
    const activeId = context?.activeTenantId ?? null;
    if (!activeId) return null;
    return tenants.find((t: any) => t?.tenantId === activeId) ?? null;
  }, [tenants, context?.activeTenantId]);

  const hasActiveTenant = Boolean(activeTenant?.tenantId);

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <div className="mx-auto max-w-5xl px-6 py-10 space-y-8">
        {/* Header */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Admin</h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Manage quotes, settings, and tenant context.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/admin/quotes"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Quotes
            </Link>
            <Link
              href="/onboarding"
              className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
            >
              Settings
            </Link>
          </div>
        </header>

        {/* Active tenant card */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold">Active tenant</h2>

              {hasActiveTenant ? (
                <>
                  <div className="mt-2 text-lg font-semibold">{activeTenant?.name ?? "Unnamed tenant"}</div>
                  <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    <span className="font-mono text-xs">{activeTenant?.tenantId}</span>
                  </div>
                </>
              ) : (
                <div className="mt-3 rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
                  No active tenant selected. Go to{" "}
                  <Link className="underline" href="/onboarding">
                    Settings
                  </Link>{" "}
                  and make sure your tenant is created/selected.
                </div>
              )}
            </div>

            <div className="flex flex-col items-end gap-2">
              <div className="text-xs text-gray-500 dark:text-gray-400">Tenant context</div>
              <div className={cn("text-sm font-semibold", hasActiveTenant ? "" : "opacity-60")}>
                {hasActiveTenant ? "Ready" : "Needs setup"}
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href="/admin/quotes"
              className={cn(
                "rounded-lg border px-4 py-2 text-sm font-semibold",
                "border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900",
                !hasActiveTenant && "opacity-60 pointer-events-none"
              )}
            >
              View quotes
            </Link>

            <Link
              href="/onboarding"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Change tenant
            </Link>
          </div>
        </section>

        {/* Quick links */}
        <section className="grid gap-4 sm:grid-cols-2">
          <Link
            href="/admin/quotes"
            className={cn(
              "rounded-2xl border border-gray-200 bg-white p-6 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900",
              !hasActiveTenant && "opacity-60 pointer-events-none"
            )}
          >
            <div className="text-sm font-semibold">Quotes</div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Review incoming leads, stages, and rendering status.
            </div>
          </Link>

          <Link
            href="/onboarding"
            className="rounded-2xl border border-gray-200 bg-white p-6 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900"
          >
            <div className="text-sm font-semibold">Settings</div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Business info, reporting defaults, AI rendering toggle.
            </div>
          </Link>
        </section>

        {/* Debug (optional) */}
        <details className="rounded-2xl border border-gray-200 bg-white p-4 text-sm dark:border-gray-800 dark:bg-gray-950">
          <summary className="cursor-pointer font-semibold">Debug context</summary>
          <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-800 dark:bg-black">
            {JSON.stringify(
              {
                activeTenantId: context?.activeTenantId ?? null,
                tenantsCount: tenants.length,
                tenantsPreview: tenants.slice(0, 3),
              },
              null,
              2
            )}
          </pre>
        </details>
      </div>
    </main>
  );
}