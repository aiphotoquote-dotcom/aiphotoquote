// src/app/auth/after-sign-in/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type ContextResp =
  | {
      ok: true;
      activeTenantId: string | null;
      tenants: Array<any>;
      needsTenantSelection?: boolean;
      autoSelected?: boolean;
      clearedStaleCookie?: boolean;
    }
  | { ok: false; error: string; message?: string };

export default function AfterSignInPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const res = await fetch("/api/tenant/context", {
          cache: "no-store",
          credentials: "include",
        });

        const data = (await res.json()) as ContextResp;

        if (cancelled) return;

        if (!("ok" in data) || !data.ok) {
          router.replace("/admin");
          return;
        }

        const tenantCount = Array.isArray(data.tenants) ? data.tenants.length : 0;
        const hasActiveTenant = Boolean(data.activeTenantId);

        if (hasActiveTenant) {
          router.replace("/admin");
          return;
        }

        if (tenantCount === 0) {
          router.replace("/onboarding");
          return;
        }

        router.replace("/admin/select-tenant");
      } catch {
        if (!cancelled) router.replace("/admin");
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-700">
        Preparing your workspace…
      </div>
    </div>
  );
}