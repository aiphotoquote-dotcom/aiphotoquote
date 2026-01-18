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
  | { ok: false; error: any; message?: string };

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

        if (!json || !("ok" in json) || !json.ok) {
          setComplete(false);
          return;
        }

        const industry = json.settings?.industry_key ?? "";
        const slug = json.tenant?.slug ?? "";

        // Minimal “complete”
        setComplete(Boolean(industry && slug));
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
    <header className="border-b">
      <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
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

              <Link className="underline" href="/onboarding">
                {settingsLabel}
                {complete === false && (
                  <span className="ml-2 rounded-full border px-2 py-0.5 text-xs">
                    Setup
                  </span>
                )}
              </Link>

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
