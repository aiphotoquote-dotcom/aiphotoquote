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
  | { ok: false; error: any; message?: string };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function TopNav() {
  // null = loading/unknown, false = incomplete, true = complete
  const [complete, setComplete] = useState<boolean | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/tenant/me-settings", { cache: "no-store" });
        const json: MeSettingsResponse = await res.json();

        if (cancelled) return;

        if (!json || !("ok" in json) || !json.ok) {
          setComplete(false);
          setTenantSlug("");
          return;
        }

        const slug = json.tenant?.slug ? String(json.tenant.slug) : "";
        setTenantSlug(slug);

        const s = json.settings;
        const industry = s?.industry_key ?? "";

        // Minimal “complete” right now: Industry must be set.
        // You can tighten later to require redirect_url, key verification, etc.
        setComplete(Boolean(industry));
      } catch {
        if (!cancelled) {
          setComplete(false);
          setTenantSlug("");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const settingsLabel = complete === true ? "Settings" : "Configure";

  const setupBadge = useMemo(() => {
    if (complete === null) return null;
    if (complete === true) return null;
    return (
      <span className="ml-2 rounded-full border border-yellow-200 bg-yellow-50 px-2 py-0.5 text-xs font-semibold text-yellow-900">
        Setup
      </span>
    );
  }, [complete]);

  const brand = (
    <div className="flex items-center gap-3">
      <span className="font-semibold text-lg">AIPhotoQuote</span>
      {tenantSlug ? (
        <span className="hidden sm:inline rounded-full border px-2 py-0.5 text-xs font-mono text-gray-600">
          {tenantSlug}
        </span>
      ) : null}
    </div>
  );

  return (
    <header className="border-b bg-white">
      <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
        <SignedOut>
          <Link href="/" className="hover:opacity-90">
            {brand}
          </Link>
        </SignedOut>

        <SignedIn>
          <Link href="/dashboard" className="hover:opacity-90">
            {brand}
          </Link>
        </SignedIn>

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

              <Link className="underline flex items-center" href="/onboarding">
                {settingsLabel}
                {setupBadge}
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
