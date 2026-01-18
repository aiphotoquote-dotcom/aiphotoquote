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

function Badge({
  label,
  tone,
}: {
  label: string;
  tone: "ok" | "warn" | "idle" | "loading";
}) {
  const cls =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : tone === "loading"
          ? "border-gray-200 bg-gray-50 text-gray-700"
          : "border-gray-200 bg-white text-gray-700";

  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold", cls)}>
      {label}
    </span>
  );
}

export default function TopNav() {
  const [loading, setLoading] = useState(true);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);

  // “Complete” here should match your earlier intent: industry chosen => setup complete
  const [industryKey, setIndustryKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/tenant/me-settings", { cache: "no-store" });
        const json: MeSettingsResponse = await res.json();

        if (cancelled) return;

        if (!("ok" in json) || !json.ok) {
          setTenantSlug(null);
          setIndustryKey(null);
          setLoading(false);
          return;
        }

        setTenantSlug(json.tenant?.slug ?? null);
        setIndustryKey(json.settings?.industry_key ?? null);
        setLoading(false);
      } catch {
        if (!cancelled) {
          setTenantSlug(null);
          setIndustryKey(null);
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const setupComplete = useMemo(() => {
    return Boolean((industryKey ?? "").trim());
  }, [industryKey]);

  const quoteHref = useMemo(() => {
    return tenantSlug ? `/q/${tenantSlug}` : null;
  }, [tenantSlug]);

  const settingsLabel = useMemo(() => {
    if (loading) return "Settings";
    return setupComplete ? "Settings" : "Configure";
  }, [loading, setupComplete]);

  return (
    <header className="border-b bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold text-lg text-gray-900">
          AIPhotoQuote
        </Link>

        <div className="flex items-center gap-3 text-sm">
          <SignedOut>
            <Link className="rounded-lg border border-gray-200 bg-white px-3 py-2 font-semibold text-gray-900" href="/sign-in">
              Sign in
            </Link>
            <Link className="rounded-lg bg-gray-900 px-3 py-2 font-semibold text-white" href="/sign-up">
              Sign up
            </Link>
          </SignedOut>

          <SignedIn>
            <nav className="hidden items-center gap-2 sm:flex">
              <Link
                className="rounded-lg px-3 py-2 font-semibold text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                href="/dashboard"
              >
                Dashboard
              </Link>

              <Link
                className="rounded-lg px-3 py-2 font-semibold text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                href="/onboarding"
              >
                {settingsLabel}
              </Link>

              {/* Optional: public quote link if tenantSlug exists */}
              {quoteHref ? (
                <Link
                  className="rounded-lg px-3 py-2 font-semibold text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                  href={quoteHref}
                >
                  Public page
                </Link>
              ) : null}

              <Link
                className="rounded-lg px-3 py-2 font-semibold text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                href="/admin"
              >
                Admin
              </Link>

              {/* Setup badge */}
              {loading ? (
                <Badge label="Checking…" tone="loading" />
              ) : setupComplete ? (
                <Badge label="Setup complete" tone="ok" />
              ) : (
                <Badge label="Setup needed" tone="warn" />
              )}
            </nav>

            {/* Mobile condensed: show only badge + user button */}
            <div className="flex items-center gap-2 sm:hidden">
              {loading ? (
                <Badge label="…" tone="loading" />
              ) : setupComplete ? (
                <Badge label="Setup OK" tone="ok" />
              ) : (
                <Badge label="Setup" tone="warn" />
              )}
            </div>

            <UserButton />
          </SignedIn>
        </div>
      </div>
    </header>
  );
}
