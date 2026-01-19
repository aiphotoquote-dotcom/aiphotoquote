"use client";

import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { useEffect, useState } from "react";

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

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/tenant/me-settings", { cache: "no-store" });
        const json: MeSettingsResponse = await res.json();

        if (cancelled) return;

        if (!("ok" in json) || !json.ok) {
          setComplete(false);
          return;
        }

        const s = json.settings;
        const industry = s?.industry_key ?? "";
        setComplete(Boolean(industry));
      } catch {
        if (!cancelled) setComplete(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const settingsLabel = complete === true ? "Settings" : "Configure";

  return (
    <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-black">
      <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
        <Link
          href="/"
          className="font-semibold text-lg text-gray-900 hover:opacity-90 dark:text-gray-100"
        >
          AIPhotoQuote
        </Link>

        <div className="flex items-center gap-4 text-sm">
          <SignedOut>
            <Link
              className="underline text-gray-700 hover:text-gray-900 dark:text-gray-200 dark:hover:text-gray-50"
              href="/sign-in"
            >
              Sign in
            </Link>
            <Link
              className="underline text-gray-700 hover:text-gray-900 dark:text-gray-200 dark:hover:text-gray-50"
              href="/sign-up"
            >
              Sign up
            </Link>
          </SignedOut>

          <SignedIn>
            <nav className="flex items-center gap-4">
              <Link
                className="underline text-gray-700 hover:text-gray-900 dark:text-gray-200 dark:hover:text-gray-50"
                href="/dashboard"
              >
                Dashboard
              </Link>

              <Link
                className={cn(
                  "underline text-gray-700 hover:text-gray-900 dark:text-gray-200 dark:hover:text-gray-50",
                  complete === false ? "font-semibold" : ""
                )}
                href="/onboarding"
              >
                {settingsLabel}
                {complete === false && (
                  <span className="ml-2 rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-700 dark:border-gray-700 dark:text-gray-200">
                    Setup
                  </span>
                )}
              </Link>

              <Link
                className="underline text-gray-700 hover:text-gray-900 dark:text-gray-200 dark:hover:text-gray-50"
                href="/admin"
              >
                Admin
              </Link>
            </nav>

            <div className="ml-2">
              <UserButton />
            </div>
          </SignedIn>
        </div>
      </div>
    </header>
  );
}
