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

export default function TopNav() {
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/tenant/me-settings", { cache: "no-store" });
        const json: MeSettingsResponse = await res.json();

        if (cancelled) return;

        if (!("ok" in json) || !json.ok) {
          // If we can't load it, don't hide onboarding (safe default)
          setOnboardingComplete(false);
          return;
        }

        const s = json.settings;
        const industry = s?.industry_key ?? "";
        const redirect = s?.redirect_url ?? "";

        // Define "complete" here. Minimum: industry set.
        // If you want redirect required too, change to: Boolean(industry && redirect)
        const complete = Boolean(industry);

        setOnboardingComplete(complete);
      } catch {
        if (!cancelled) setOnboardingComplete(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <header className="border-b">
      <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
        <Link href="/" className="font-semibold text-lg">
          AIPhotoQuote
        </Link>

        <div className="flex items-center gap-4 text-sm">
          <SignedOut>
            <Link className="underline" href="/sign-in">
              Sign in
            </Link>
            <Link className="underline" href="/sign-up">
              Sign up
            </Link>
          </SignedOut>

          <SignedIn>
            <nav className="flex items-center gap-4">
              <Link className="underline" href="/dashboard">
                Dashboard
              </Link>

              {/* Only show onboarding link if not complete (or while unknown, show it) */}
              {onboardingComplete !== true && (
                <Link className="underline" href="/onboarding">
                  Onboarding
                  {onboardingComplete === false && (
                    <span className="ml-2 rounded-full border px-2 py-0.5 text-xs">
                      Setup
                    </span>
                  )}
                </Link>
              )}

              <Link className="underline" href="/admin">
                Admin
              </Link>
            </nav>
            <UserButton />
          </SignedIn>
        </div>
      </div>
    </header>
  );
}
