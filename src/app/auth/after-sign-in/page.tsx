"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type ContextResp =
  | { ok: true; activeTenantId: string | null; tenants: Array<any>; needsTenantSelection?: boolean }
  | { ok: false; error: string; message?: string };

export default function AfterSignInPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        // This will auto-select + set cookie when there is exactly 1 tenant
        const res = await fetch("/api/tenant/context", { cache: "no-store" });
        const data = (await res.json()) as ContextResp;

        if (cancelled) return;

        if (!("ok" in data) || !data.ok) {
          router.replace("/dashboard");
          return;
        }

        // If we have an active tenant, we’re good
        if (data.activeTenantId) {
          router.replace("/admin");
          return;
        }

        // Multiple tenants (or none): send them to admin where your switcher exists,
        // OR you can create a dedicated tenant-picker page later.
        // If you want a dedicated picker, change this to: router.replace("/select-tenant");
        router.replace("/admin");
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