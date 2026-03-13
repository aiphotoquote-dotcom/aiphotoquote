// src/components/tenant/AdminTenantGateShell.tsx

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import AdminTopNav from "@/components/admin/AdminTopNav";

type TenantContextResp =
  | {
      ok: true;
      activeTenantId: string | null;
      tenants: Array<any>;
      needsTenantSelection?: boolean;
      autoSelected?: boolean;
      clearedStaleCookie?: boolean;
    }
  | {
      ok: false;
      error: string;
      message?: string;
    };

function samePath(pathname: string, target: string) {
  return pathname === target || pathname.startsWith(`${target}/`);
}

export default function AdminTenantGateShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const [checked, setChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);

  const bypassChrome = useMemo(() => {
    return (
      pathname.startsWith("/sign-in") ||
      pathname.startsWith("/sign-up") ||
      pathname.startsWith("/onboarding")
    );
  }, [pathname]);

  const allowTenantlessAdminPage = useMemo(() => {
    return pathname.startsWith("/admin/select-tenant");
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (bypassChrome) {
        if (!cancelled) {
          setAllowed(true);
          setChecked(true);
        }
        return;
      }

      if (allowTenantlessAdminPage) {
        if (!cancelled) {
          setAllowed(true);
          setChecked(true);
        }
        return;
      }

      try {
        const res = await fetch("/api/tenant/context", { cache: "no-store" });
        const data = (await res.json()) as TenantContextResp;

        if (cancelled) return;

        if (!("ok" in data) || !data.ok) {
          // Do NOT assume onboarding on transient/context failures.
          // Let the centralized auth landing page decide.
          if (!samePath(pathname, "/auth/after-sign-in")) {
            router.replace("/auth/after-sign-in");
          }
          return;
        }

        const tenants = Array.isArray(data.tenants) ? data.tenants : [];
        const tenantCount = tenants.length;
        const hasActiveTenant = Boolean(data.activeTenantId);

        if (hasActiveTenant) {
          setAllowed(true);
          setChecked(true);
          return;
        }

        // Only truly brand-new / tenantless users should go to onboarding.
        if (tenantCount === 0) {
          if (!samePath(pathname, "/onboarding")) {
            router.replace("/onboarding");
          }
          return;
        }

        // Existing user with tenants but no active tenant cookie yet.
        if (!samePath(pathname, "/admin/select-tenant")) {
          router.replace("/admin/select-tenant");
        }
      } catch {
        if (cancelled) return;

        // Network/timing issue: do not dump existing users into onboarding.
        if (!samePath(pathname, "/auth/after-sign-in")) {
          router.replace("/auth/after-sign-in");
        }
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [allowTenantlessAdminPage, bypassChrome, pathname, router]);

  if (bypassChrome) {
    return <>{children}</>;
  }

  if (!checked || !allowed) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-neutral-950">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
            Preparing your workspace…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-neutral-950">
      <AdminTopNav />
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}