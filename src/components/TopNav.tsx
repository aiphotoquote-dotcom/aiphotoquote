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
  const [me, setMe] = useState<MeSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/tenant/me-settings", { cache: "no-store" });
        const json: MeSettingsResponse = await res.json();

        if (cancelled) return;
        setMe(json);
      } catch {
        if (!cancelled) setMe({ ok: false, error: "FETCH_FAILED" } as any);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const ok = Boolean(me && "ok" in me && (me as any).ok === true);

  const tenantName = ok ? (me as any).tenant?.name ?? "" : "";
  const tenantSlug = ok ? (me as any).tenant?.slug ?? "" : "";
  const industryKey = ok ? (me as any).settings?.industry_key ?? null : null;

  const setupComplete = Boolean((industryKey ?? "").trim());
  const settingsLabel = setupComplete ? "Settings" : "Configure";
  const hasPublicPage = Boolean((tenantSlug ?? "").trim());

  const subtitle = useMemo(() => {
    if (loading) return "Loading tenant…";
    if (!ok) return "";
    const parts: string[] = [];
    if (tenantName) parts.push(tenantName);
    if (tenantSlug) parts.push(`/${tenantSlug}`);
    return parts.join(" · ");
  }, [loading, ok, tenantName, tenantSlug]);

  return (
    <header className="border-b bg-white">
      <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Link href="/" className="font-semibold text-lg text-gray-900">
            AIPhotoQuote
          </Link>
          {subtitle ? (
            <div className="truncate text-xs text-gray-600 mt-0.5">{subtitle}</div>
          ) : null}
        </div>

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
            <nav className="hidden sm:flex items-center gap-4">
              <Link className="underline" href="/dashboard">
                Dashboard
              </Link>

              <Link className="underline" href="/onboarding">
                {settingsLabel}
                {!loading && ok && !setupComplete ? (
                  <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">
                    Setup
                  </span>
                ) : null}
              </Link>

              <Link className="underline" href="/admin">
                Admin
              </Link>

              {hasPublicPage ? (
                <Link className="underline" href={`/q/${tenantSlug}`}>
                  Public Quote
                </Link>
              ) : null}
            </nav>

            {/* Mobile: keep it simple */}
            <nav className="sm:hidden flex items-center gap-3">
              <Link className="underline" href="/dashboard">
                Dashboard
              </Link>
              <Link className="underline" href="/onboarding">
                {settingsLabel}
              </Link>
              {hasPublicPage ? (
                <Link className="underline" href={`/q/${tenantSlug}`}>
                  Quote
                </Link>
              ) : null}
            </nav>

            <UserButton />
          </SignedIn>
        </div>
      </div>

      {/* thin status strip (optional but helpful for flow) */}
      <SignedIn>
        <div className="border-t bg-gray-50">
          <div className="mx-auto max-w-5xl px-6 py-2 text-xs text-gray-700 flex items-center justify-between">
            <div className="truncate">
              {loading ? (
                "Checking tenant setup…"
              ) : ok ? (
                setupComplete ? (
                  "Tenant setup looks good."
                ) : (
                  "Tenant setup incomplete — finish Configure."
                )
              ) : (
                "Tenant not resolved — complete onboarding or sign in again."
              )}
            </div>

            {ok && !setupComplete ? (
              <Link
                href="/onboarding"
                className="font-semibold underline decoration-gray-300 hover:decoration-gray-500"
              >
                Fix now →
              </Link>
            ) : null}
          </div>
        </div>
      </SignedIn>
    </header>
  );
}
