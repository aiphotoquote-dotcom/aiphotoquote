// src/app/auth/after-sign-in/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

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

function safeInvite(v: string | null) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

export default function AfterSignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const inviteCode = safeInvite(searchParams.get("invite"));

        // ✅ If an invite is present, force onboarding flow.
        // This allows an existing Clerk user / existing tenant user
        // to explicitly start a brand new invited onboarding.
        if (inviteCode) {
          router.replace(`/onboarding?invite=${encodeURIComponent(inviteCode)}`);
          return;
        }

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
  }, [router, searchParams]);

  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-700">
        Preparing your workspace…
      </div>
    </div>
  );
}