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

function pill(label: string) {
  return (
    <span className="ml-2 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-semibold text-gray-700">
      {label}
    </span>
  );
}

export default function TopNav() {
  const [me, setMe] = useState<MeSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/tenant/me-settings", { cache: "no-store" });
        const json: MeSettingsResponse = await res.json();
        if (!cancelled) setMe(json);
      } catch {
        if (!cancelled) setMe({ ok: false, error: "FETCH_FAILED" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const computed = useMemo(() => {
    const ok = Boolean(me && "ok" in me && me.ok);
    const tenant = ok ? (me as any).tenant : null;
    const settings = ok ? (me as any).settings : null;

    const tenantSlug = tenant?.slug ? String(tenant.slug) : "";
    const industryKey = settings?.industry_key ? String(settings.industry_key) : "";

    const hasSlug = Boolean(tenantSlug);
    const hasIndustry = Boolean(industryKey);

    // minimal ready = slug + industry
    const isReady = hasSlug && hasIndustry;

    const publicPath = tenantSlug ? `/q/${tenantSlug}` : "";

    return {
      ok,
      tenantSlug,
      industryKey,
      hasSlug,
      hasIndustry,
      isReady,
      publicPath,
    };
  }, [me]);

  const settingsLabel = loading ? "Configure" : computed.isReady ? "Settings" : "Configure";

  async function copyPublicLink() {
    if (!computed.publicPath) return;

    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "";

    const full = origin ? `${origin}${computed.publicPath}` : computed.publicPath;

    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <header className="border-b bg-white">
      <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between gap-4">
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
                {!loading && computed.ok && !computed.isReady && pill("Setup")}
              </Link>

              {/* Share link shows only when ready (slug exists) */}
              {!loading && computed.ok && computed.isReady && computed.publicPath ? (
                <button
                  type="button"
                  onClick={copyPublicLink}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs font-semibold",
                    copied ? "border-green-200 bg-green-50 text-green-800" : "border-gray-200 hover:bg-gray-50"
                  )}
                  title="Copy public quote page link"
                >
                  {copied ? "Copied!" : "Copy quote link"}
                </button>
              ) : null}

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
