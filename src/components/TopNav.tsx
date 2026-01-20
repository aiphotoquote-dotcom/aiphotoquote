"use client";

import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { useEffect, useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

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

type TenantListResp =
  | {
      ok: true;
      activeTenantId: string | null;
      tenants: Array<{ id: string; name: string; slug: string }>;
    }
  | { ok: false; error: any; message?: string };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function TopNav() {
  const router = useRouter();
  const pathname = usePathname();

  // Setup-complete badge logic (industry_key)
  const [complete, setComplete] = useState<boolean | null>(null);

  // Tenant switcher state
  const [tenantListLoading, setTenantListLoading] = useState(true);
  const [tenantList, setTenantList] = useState<Array<{ id: string; name: string; slug: string }>>(
    []
  );
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  // Load setup completeness
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

  // Load list of tenants (owned by the signed-in user)
  useEffect(() => {
    let cancelled = false;

    async function loadTenants() {
      setTenantListLoading(true);
      try {
        const res = await fetch("/api/tenant/list", { cache: "no-store" });
        const json: TenantListResp = await res.json();

        if (cancelled) return;

        if (!("ok" in json) || !json.ok) {
          setTenantList([]);
          setActiveTenantId(null);
          return;
        }

        setTenantList(Array.isArray(json.tenants) ? json.tenants : []);
        setActiveTenantId(json.activeTenantId ?? null);
      } catch {
        if (!cancelled) {
          setTenantList([]);
          setActiveTenantId(null);
        }
      } finally {
        if (!cancelled) setTenantListLoading(false);
      }
    }

    loadTenants();
    return () => {
      cancelled = true;
    };
  }, []);

  const settingsLabel = complete === true ? "Settings" : "Configure";

  const activeTenantLabel = useMemo(() => {
    if (!activeTenantId) return "Select tenant";
    const t = tenantList.find((x) => x.id === activeTenantId);
    return t ? t.name : "Select tenant";
  }, [activeTenantId, tenantList]);

  async function switchTenant(nextTenantId: string) {
    const tid = String(nextTenantId || "").trim();
    if (!tid || tid === activeTenantId) return;

    setSwitching(true);
    try {
      await fetch("/api/tenant/context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: tid }),
      });

      setActiveTenantId(tid);

      // Refresh server components + data
      router.refresh();

      // If you’re currently in admin pages, refresh helps,
      // but some pages may still cache client state. This ensures a clean view.
      if (pathname?.startsWith("/admin")) {
        // stay on the same page, just reload
        window.location.reload();
      }
    } catch {
      // no toast yet; keep it silent for now
    } finally {
      setSwitching(false);
    }
  }

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

              {/* Tenant switcher */}
              <div className="hidden sm:flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">Tenant</span>

                <div className="relative">
                  <select
                    value={activeTenantId ?? ""}
                    onChange={(e) => switchTenant(e.target.value)}
                    disabled={tenantListLoading || switching || tenantList.length <= 1}
                    className={cn(
                      "rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900",
                      "dark:border-gray-800 dark:bg-black dark:text-gray-100",
                      tenantList.length <= 1 ? "opacity-70" : "",
                      "focus:outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-700"
                    )}
                    aria-label="Select tenant"
                  >
                    {/* Placeholder when no active tenant */}
                    {!activeTenantId ? <option value="">{activeTenantLabel}</option> : null}

                    {tenantList.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.slug})
                      </option>
                    ))}
                  </select>

                  {switching ? (
                    <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                      Switching…
                    </span>
                  ) : null}
                </div>
              </div>
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
