"use client";

import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { useEffect, useMemo, useState } from "react";

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

export default function TopNav() {
  // null = unknown/loading, false = incomplete, true = complete
  const [complete, setComplete] = useState<boolean | null>(null);
  const [tenant, setTenant] = useState<{ id: string; name: string; slug: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/tenant/me-settings", { cache: "no-store" });
        const json: MeSettingsResponse = await res.json();

        if (cancelled) return;

        if (!("ok" in json) || !json.ok) {
          setComplete(false);
          setTenant(null);
          return;
        }

        setTenant(json.tenant ?? null);

        const s = json.settings;
        const industry = (s?.industry_key ?? "").trim();
        // NOTE: keep your current definition of "complete"
        setComplete(Boolean(industry));
      } catch {
        if (!cancelled) {
          setComplete(false);
          setTenant(null);
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
    const slug = tenant?.slug?.trim();
    return slug ? `/q/${slug}` : null;
  }, [tenant?.slug]);

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/80 backdrop-blur dark:border-gray-800 dark:bg-black/60">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            AIPhotoQuote
          </Link>

          {/* Tenant chip (signed in) */}
          <SignedIn>
            <div className="hidden sm:flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-gray-400 dark:bg-gray-600" />
              <div className="text-xs text-gray-600 dark:text-gray-300">
                {tenant ? (
                  <>
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {tenant.name}
                    </span>
                    <span className="ml-2 font-mono text-[11px] text-gray-600 dark:text-gray-400">
                      /{tenant.slug}
                    </span>
                  </>
                ) : (
                  <span className="text-gray-500">Loading tenant…</span>
                )}
              </div>
            </div>
          </SignedIn>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3 text-sm">
          <SignedOut>
            <Link
              className="rounded-md border border-gray-200 px-3 py-2 font-medium text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-100 dark:hover:bg-gray-900"
              href="/sign-in"
            >
              Sign in
            </Link>
            <Link
              className="rounded-md bg-black px-3 py-2 font-medium text-white hover:opacity-90 dark:bg-white dark:text-black"
              href="/sign-up"
            >
              Sign up
            </Link>
          </SignedOut>

          <SignedIn>
            <nav className="hidden items-center gap-2 md:flex">
              <Link
                className="rounded-md px-3 py-2 font-medium text-gray-900 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-900"
                href="/dashboard"
              >
                Dashboard
              </Link>

              <Link
                className={cn(
                  "rounded-md px-3 py-2 font-medium hover:bg-gray-50 dark:hover:bg-gray-900",
                  complete === false
                    ? "text-gray-900 dark:text-gray-100"
                    : "text-gray-900 dark:text-gray-100"
                )}
                href="/onboarding"
              >
                <span className="inline-flex items-center gap-2">
                  {settingsLabel}
                  {complete === false ? (
                    <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
                      Setup
                    </span>
                  ) : null}
                </span>
              </Link>

              <Link
                className="rounded-md px-3 py-2 font-medium text-gray-900 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-900"
                href="/admin"
              >
                Admin
              </Link>

              {/* Public quote link */}
              {publicQuoteHref ? (
                <Link
                  className="rounded-md border border-gray-200 px-3 py-2 font-medium text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-100 dark:hover:bg-gray-900"
                  href={publicQuoteHref}
                  target="_blank"
                >
                  Public Quote
                </Link>
              ) : (
                <span className="rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  Set tenant slug to enable Public Quote
                </span>
              )}
            </nav>

            {/* Mobile: only show Public Quote if available */}
            {publicQuoteHref ? (
              <Link
                className="md:hidden rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:text-gray-100"
                href={publicQuoteHref}
                target="_blank"
              >
                Public Quote
              </Link>
            ) : null}

            <UserButton />
          </SignedIn>
        </div>
      </div>
    </header>
  );
}
