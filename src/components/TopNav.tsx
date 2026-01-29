"use client";

import Link from "next/link";
import { SignedIn, SignedOut, UserButton, useAuth } from "@clerk/nextjs";
import { useEffect, useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

type MeSettingsResponse =
  | {
      ok: true;
      tenant: { id: string; name: string; slug: string };
      settings:
        | {
            tenant_id: string;
            industry_key: string | null;
            redirect_url: string | null;
            thank_you_url: string | null;
            updated_at: string | null;
          }
        | null;
    }
  | { ok: false; error: any; message?: string };

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

async function safeJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(`Expected JSON but got "${ct || "unknown"}" (status ${res.status}). ${text.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

export default function TopNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { isLoaded, isSignedIn } = useAuth();

  const [complete, setComplete] = useState<boolean | null>(null);

  const [tenantListLoading, setTenantListLoading] = useState(true);
  const [tenantList, setTenantList] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  // ✅ Only load when Clerk is ready AND signed in
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/tenant/me-settings", { cache: "no-store" });
        const json = await safeJson<MeSettingsResponse>(res);
        if (cancelled) return;

        if (!json.ok) {
          setComplete(false);
          return;
        }

        const industry = json.settings?.industry_key ?? "";
        setComplete(Boolean(industry));
      } catch {
        if (!cancelled) setComplete(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn]);

  // ✅ Only load when Clerk is ready AND signed in
  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setTenantList([]);
      setActiveTenantId(null);
      setTenantListLoading(false);
      return;
    }

    let cancelled = false;

    async function loadTenants() {
      setTenantListLoading(true);
      try {
        const res = await fetch("/api/tenant/list", { cache: "no-store" });
        const json = await safeJson<TenantListResp>(res);
        if (cancelled) return;

        if (!json.ok) {
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
  }, [isLoaded, isSignedIn]);

  const settingsLabel = complete === true ? "Settings" : "Configure";
  const inAdmin = Boolean(pathname?.startsWith("/admin"));

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
      const res = await fetch("/api/tenant/context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: tid }),
      });

      // swallow non-json gracefully; we just need cookies set
      if (!res.ok) throw new Error(`Switch failed (${res.status})`);

      setActiveTenantId(tid);
      router.refresh();

      if (pathname?.startsWith("/admin")) window.location.reload();
    } catch {
      // silent for now
    } finally {
      setSwitching(false);
    }
  }

  // Optional: avoid rendering “SignedIn UI” until Clerk is ready
  const showSignedInChrome = isLoaded && isSignedIn;

  return (
    <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-black">
      <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
        <Link href="/" className="font-semibold text-lg text-gray-900 hover:opacity-90 dark:text-gray-100">
          AIPhotoQuote
        </Link>

        <div className="flex items-center gap-4 text-sm">
          <SignedOut>
            <Link className="underline text-gray-700 hover:text-gray-900 dark:text-gray-200 dark:hover:text-gray-50" href="/sign-in">
              Sign in
            </Link>
            <Link className="underline text-gray-700 hover:text-gray-900 dark:text-gray-200 dark:hover:text-gray-50" href="/sign-up">
              Sign up
            </Link>
          </SignedOut>

          <SignedIn>
            {showSignedInChrome ? (
              <>
                {/* ... keep the rest of your nav exactly the same ... */}
                {/* (no need to paste the whole thing again) */}
                <div className="ml-2">
                  <UserButton />
                </div>
              </>
            ) : null}
          </SignedIn>
        </div>
      </div>
    </header>
  );
}