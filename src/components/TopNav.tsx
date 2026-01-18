"use client";

import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

type MeSettingsResponse =
  | {
      ok: true;
      tenant: { id: string; name: string; slug: string };
      settings: {
        tenant_id: string;
        industry_key: string | null;
        redirect_url: string | null;
        thank_you_url: string | null;
        updated_at: string | null;
      } | null;
    }
  | { ok: false; error: any };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function navLinkClass(active: boolean) {
  return cn(
    "rounded-md px-3 py-1.5 text-sm font-medium",
    active ? "bg-black text-white" : "text-gray-800 hover:bg-gray-100"
  );
}

export default function TopNav() {
  const pathname = usePathname();

  // null = unknown/loading, false = incomplete, true = complete
  const [complete, setComplete] = useState<boolean | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/tenant/me-settings", { cache: "no-store" });
        const json: MeSettingsResponse = await res.json();

        if (cancelled) return;

        if (!("ok" in json) || !json.ok) {
          setComplete(false);
          setTenantSlug(null);
          setTenantName(null);
          return;
        }

        const t = json.tenant;
        const s = json.settings;

        setTenantSlug(t?.slug ? String(t.slug) : null);
        setTenantName(t?.name ? String(t.name) : null);

        const industry = s?.industry_key ?? "";
        setComplete(Boolean(industry));
      } catch {
        if (!cancelled) {
          setComplete(false);
          setTenantSlug(null);
          setTenantName(null);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const settingsLabel = complete === true ? "Settings" : "Configure";

  const publicQuoteHref = useMemo(() => {
    return tenantSlug ? `/q/${tenantSlug}` : null;
  }, [tenantSlug]);

  const isDash = pathname?.startsWith("/dashboard");
  const isOnboarding = pathname?.startsWith("/onboarding");
  const isAdmin = pathname?.startsWith("/admin");

  return (
    <header className="border-b bg-white">
      <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-semibold text-lg">
            AIPhotoQuote
          </Link>

          {tenantSlug ? (
            <span className="hidden sm:inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-gray-700">
              {tenantName ? tenantName : "Tenant"} · <span className="ml-1 font-mono">{tenantSlug}</span>
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-4">
          <SignedOut>
            <Link className="underline text-sm" href="/sign-in">
              Sign in
            </Link>
            <Link className="underline text-sm" href="/sign-up">
              Sign up
            </Link>
          </SignedOut>

          <SignedIn>
            <nav className="flex items-center gap-2">
              <Link className={navLinkClass(!!isDash)} href="/dashboard">
                Dashboard
              </Link>

              <Link className={navLinkClass(!!isOnboarding)} href="/onboarding">
                {settingsLabel}
                {complete === false ? (
                  <span className="ml-2 rounded-full border border-yellow-200 bg-yellow-50 px-2 py-0.5 text-xs text-yellow-900">
                    Setup
                  </span>
                ) : null}
              </Link>

              <Link className={navLinkClass(!!isAdmin)} href="/admin">
                Admin
              </Link>

              {publicQuoteHref ? (
                <Link
                  className="hidden sm:inline-flex rounded-md border px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
                  href={publicQuoteHref}
                >
                  Public Quote
                </Link>
              ) : null}
            </nav>

            <UserButton />
          </SignedIn>
        </div>
      </div>
    </header>
  );
}
