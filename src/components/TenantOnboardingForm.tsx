"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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

type SaveResp =
  | { ok: true }
  | { ok: false; error?: any; message?: string };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function cleanSlug(s: string) {
  return (s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeUrl(s: string) {
  const v = (s || "").trim();
  if (!v) return "";
  // allow relative redirects if you want; otherwise force https
  if (v.startsWith("/")) return v;
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

export default function TenantOnboardingForm() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [savedToast, setSavedToast] = useState(false);

  // original data (to detect dirty)
  const [orig, setOrig] = useState<{
    tenantName: string;
    tenantSlug: string;
    industryKey: string;
    redirectUrl: string;
    thankYouUrl: string;
  } | null>(null);

  // editable fields
  const [tenantName, setTenantName] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [industryKey, setIndustryKey] = useState("");
  const [redirectUrl, setRedirectUrl] = useState("");
  const [thankYouUrl, setThankYouUrl] = useState("");

  const publicQuotePath = useMemo(() => {
    const slug = cleanSlug(tenantSlug);
    return slug ? `/q/${slug}` : "/q/<tenant-slug>";
  }, [tenantSlug]);

  const isComplete = useMemo(() => {
    return Boolean((industryKey || "").trim());
  }, [industryKey]);

  const dirty = useMemo(() => {
    if (!orig) return false;
    return (
      tenantName !== orig.tenantName ||
      tenantSlug !== orig.tenantSlug ||
      industryKey !== orig.industryKey ||
      redirectUrl !== orig.redirectUrl ||
      thankYouUrl !== orig.thankYouUrl
    );
  }, [orig, tenantName, tenantSlug, industryKey, redirectUrl, thankYouUrl]);

  async function load() {
    setLoading(true);
    setLoadError(null);

    try {
      const res = await fetch("/api/tenant/me-settings", { cache: "no-store" });
      const json: MeSettingsResponse = await res.json();

      if (!("ok" in json) || !json.ok) {
        setLoadError(json?.message || "Failed to load tenant settings.");
        setLoading(false);
        return;
      }

      const t = json.tenant;
      const s = json.settings;

      const next = {
        tenantName: t?.name ?? "",
        tenantSlug: t?.slug ?? "",
        industryKey: (s?.industry_key ?? "") || "",
        redirectUrl: (s?.redirect_url ?? "") || "",
        thankYouUrl: (s?.thank_you_url ?? "") || "",
      };

      setTenantName(next.tenantName);
      setTenantSlug(next.tenantSlug);
      setIndustryKey(next.industryKey);
      setRedirectUrl(next.redirectUrl);
      setThankYouUrl(next.thankYouUrl);

      setOrig(next);
      setLoading(false);
    } catch (e: any) {
      setLoadError(e?.message ?? "Failed to load tenant settings.");
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setSaveError(null);
    setSavedToast(false);

    const slug = cleanSlug(tenantSlug);
    if (!slug || slug.length < 3) {
      setSaveError("Tenant slug must be at least 3 characters (letters/numbers/dashes).");
      return;
    }
    if (!industryKey.trim()) {
      setSaveError("Industry is required.");
      return;
    }

    setSaving(true);

    try {
      const payload = {
        // Keep payload aligned to the routes we already have in this repo:
        // api/tenant/save-settings/route.ts should accept these
        name: tenantName.trim() || null,
        slug,
        industry_key: industryKey.trim(),
        redirect_url: normalizeUrl(redirectUrl) || null,
        thank_you_url: normalizeUrl(thankYouUrl) || null,
      };

      const res = await fetch("/api/tenant/save-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      let j: SaveResp | any = null;
      try {
        j = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`Save returned non-JSON (HTTP ${res.status}).`);
      }

      if (!res.ok || !j?.ok) {
        const msg = j?.message || j?.error?.message || "Save failed.";
        throw new Error(msg);
      }

      // mark saved
      const nextOrig = {
        tenantName: tenantName,
        tenantSlug: slug,
        industryKey: industryKey.trim(),
        redirectUrl: normalizeUrl(redirectUrl) || "",
        thankYouUrl: normalizeUrl(thankYouUrl) || "",
      };
      setOrig(nextOrig);
      setTenantSlug(slug);
      setRedirectUrl(nextOrig.redirectUrl);
      setThankYouUrl(nextOrig.thankYouUrl);

      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2200);

      // Best-effort: redirect to dashboard once setup is complete (industry_key present)
      try {
        const r2 = await fetch("/api/tenant/me-settings", { cache: "no-store" });
        const j2: any = await r2.json();
        const industry = j2?.settings?.industry_key ?? "";
        if (industry) router.push("/dashboard");
      } catch {
        // ignore redirect failures; save already succeeded
      }
    } catch (e: any) {
      setSaveError(e?.message ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border bg-white p-6">
        <div className="text-sm text-gray-700">Loading settings…</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
        <div className="font-semibold text-red-900">Couldn’t load settings</div>
        <div className="mt-2 text-sm text-red-800 whitespace-pre-wrap">{loadError}</div>
        <button
          type="button"
          onClick={load}
          className="mt-4 rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Sticky save bar */}
      <div
        className={cn(
          "sticky top-3 z-10 rounded-2xl border bg-white p-4 shadow-sm transition-opacity",
          dirty ? "opacity-100" : "opacity-60"
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Tenant settings</div>
            <div className="text-xs text-gray-600">
              {isComplete ? (
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-green-600" />
                  Setup looks complete
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                  Setup required
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {savedToast ? (
              <div className="rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-semibold text-green-900">
                Saved
              </div>
            ) : null}

            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty}
              className={cn(
                "rounded-xl px-4 py-2 text-sm font-semibold",
                saving || !dirty ? "bg-gray-200 text-gray-600" : "bg-black text-white"
              )}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>

      {/* Public quote page */}
      <div className="rounded-2xl border bg-white p-6">
        <div className="text-sm font-semibold">Public quote page</div>
        <div className="mt-2 text-sm text-gray-700">
          Customers will submit photos here:
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <code className="rounded-lg border bg-gray-50 px-3 py-2 text-sm">
            {publicQuotePath}
          </code>
          <a
            className="text-sm font-semibold underline"
            href={cleanSlug(tenantSlug) ? publicQuotePath : undefined}
            onClick={(e) => {
              if (!cleanSlug(tenantSlug)) e.preventDefault();
            }}
          >
            Open
          </a>
        </div>
        <div className="mt-2 text-xs text-gray-500">
          Tip: keep your slug short and brand-safe (letters/numbers/dashes).
        </div>
      </div>

      {/* Form */}
      <div className="rounded-2xl border bg-white p-6 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-semibold">Business name</label>
            <input
              className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
              placeholder="Maggio Upholstery"
            />
          </div>

          <div>
            <label className="text-sm font-semibold">Tenant slug *</label>
            <input
              className="mt-2 w-full rounded-xl border px-3 py-2 text-sm font-mono"
              value={tenantSlug}
              onChange={(e) => setTenantSlug(cleanSlug(e.target.value))}
              placeholder="maggio-upholstery"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <div className="mt-1 text-xs text-gray-500">
              Used for your public URL: <span className="font-mono">{publicQuotePath}</span>
            </div>
          </div>
        </div>

        <div>
          <label className="text-sm font-semibold">Industry *</label>
          <input
            className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
            value={industryKey}
            onChange={(e) => setIndustryKey(e.target.value)}
            placeholder="marine"
          />
          <div className="mt-1 text-xs text-gray-500">
            Keep it simple (ex: marine, auto, motorcycle, hvac, etc.).
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-semibold">Redirect URL (optional)</label>
            <input
              className="mt-2 w-full rounded-xl border px-3 py-2 text-sm font-mono"
              value={redirectUrl}
              onChange={(e) => setRedirectUrl(e.target.value)}
              placeholder="https://yourwebsite.com/thank-you"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <div className="mt-1 text-xs text-gray-500">
              If set, we can redirect after submit (future polish).
            </div>
          </div>

          <div>
            <label className="text-sm font-semibold">Thank-you URL (optional)</label>
            <input
              className="mt-2 w-full rounded-xl border px-3 py-2 text-sm font-mono"
              value={thankYouUrl}
              onChange={(e) => setThankYouUrl(e.target.value)}
              placeholder="https://yourwebsite.com/thank-you"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <div className="mt-1 text-xs text-gray-500">
              Used by hosted flow if/when we enable it.
            </div>
          </div>
        </div>

        {saveError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 whitespace-pre-wrap">
            {saveError}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className={cn(
              "rounded-xl px-4 py-2 text-sm font-semibold",
              saving || !dirty ? "bg-gray-200 text-gray-600" : "bg-black text-white"
            )}
          >
            {saving ? "Saving…" : "Save settings"}
          </button>

          <button
            type="button"
            onClick={load}
            disabled={saving}
            className="rounded-xl border px-4 py-2 text-sm font-semibold"
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
