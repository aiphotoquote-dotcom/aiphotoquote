// src/components/TenantOnboardingForm.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type MeSettingsResponse =
  | {
      ok: true;
      tenant: { id: string; name: string; slug: string };
      settings: {
        tenant_id: string;
        industry_key: string | null;

        redirect_url?: string | null;
        thank_you_url?: string | null;

        // NEW
        reporting_timezone?: string | null;
        week_starts_on?: number | null;

        updated_at: string | null;
      } | null;
    }
  | { ok: false; error: any; message?: string };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function clampWeekStartsOn(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 1; // Monday default
  const i = Math.trunc(n);
  if (i < 0) return 0;
  if (i > 6) return 6;
  return i;
}

export default function TenantOnboardingForm(props: { redirectToDashboard?: boolean }) {
  const redirectToDashboard = Boolean(props.redirectToDashboard);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [tenantName, setTenantName] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");

  const [industryKey, setIndustryKey] = useState("");
  const [redirectUrl, setRedirectUrl] = useState("");
  const [thankYouUrl, setThankYouUrl] = useState("");

  // NEW (tenant settings)
  const [reportingTimezone, setReportingTimezone] = useState("America/New_York");
  const [weekStartsOn, setWeekStartsOn] = useState<number>(1); // Monday

  const canSave = useMemo(() => {
    return Boolean(tenantSlug.trim().length >= 3 && industryKey.trim().length >= 1);
  }, [tenantSlug, industryKey]);

  function pickString(s: any, key: string, fallback = "") {
    const v = s?.[key];
    return typeof v === "string" ? v : fallback;
  }

  function pickNumber(s: any, key: string, fallback: number) {
    const v = s?.[key];
    if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Math.trunc(Number(v));
    return fallback;
  }

  async function load() {
    setLoading(true);
    setLoadErr(null);
    setSaved(false);

    try {
      const res = await fetch("/api/tenant/me-settings", { cache: "no-store" });
      const json: MeSettingsResponse = await res.json();

      if (!("ok" in json) || !json.ok) {
        setLoadErr(json?.message || "Failed to load tenant settings.");
        return;
      }

      setTenantName(json.tenant?.name ?? "");
      setTenantSlug(json.tenant?.slug ?? "");

      const s: any = json.settings ?? null;

      setIndustryKey(pickString(s, "industry_key", ""));
      setRedirectUrl(pickString(s, "redirect_url", ""));
      setThankYouUrl(pickString(s, "thank_you_url", ""));

      // NEW
      setReportingTimezone(pickString(s, "reporting_timezone", "America/New_York") || "America/New_York");
      setWeekStartsOn(clampWeekStartsOn(pickNumber(s, "week_starts_on", 1)));
    } catch (e: any) {
      setLoadErr(e?.message ?? "Failed to load tenant settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setSaveErr(null);
    setSaved(false);

    // We keep Monday as default AND we keep it locked to Monday for now.
    const safeWeekStartsOn = 1;

    const payload = {
      tenantSlug: tenantSlug.trim(),
      industry_key: industryKey.trim(),

      redirect_url: redirectUrl.trim() || null,
      thank_you_url: thankYouUrl.trim() || null,

      // NEW
      reporting_timezone: reportingTimezone.trim() || "America/New_York",
      week_starts_on: safeWeekStartsOn,
    };

    setSaving(true);
    try {
      const res = await fetch("/api/tenant/save-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      let j: any = null;
      try {
        j = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`Save returned non-JSON (HTTP ${res.status}).`);
      }

      if (!res.ok || !j?.ok) {
        throw new Error(j?.message || j?.error || `Save failed (HTTP ${res.status}).`);
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 1200);

      await load();

      if (redirectToDashboard) router.push("/dashboard");
    } catch (e: any) {
      setSaveErr(e?.message ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Settings
            </div>
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              Configure your tenant, public link behavior, and reporting defaults.
            </div>
          </div>

          <button
            type="button"
            onClick={load}
            disabled={loading || saving}
            className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:hover:bg-gray-900"
          >
            Refresh
          </button>
        </div>

        {loadErr ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
            {loadErr}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-4 text-sm text-gray-600 dark:text-gray-300">Loading…</div>
        ) : (
          <div className="mt-5 grid gap-5">
            {/* Tenant identity */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs text-gray-700 dark:text-gray-200">Tenant name</div>
                <input
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
                  value={tenantName}
                  readOnly
                />
              </div>

              <div>
                <div className="text-xs text-gray-700 dark:text-gray-200">
                  Tenant slug <span className="text-red-600">*</span>
                </div>
                <input
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
                  value={tenantSlug}
                  onChange={(e) => setTenantSlug(e.target.value)}
                  placeholder="my-shop"
                  disabled={saving}
                  autoComplete="off"
                />
                <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                  Customers will use:{" "}
                  <span className="font-mono">/q/{tenantSlug || "<tenant-slug>"}</span>
                </div>
              </div>
            </div>

            {/* Industry */}
            <div>
              <div className="text-xs text-gray-700 dark:text-gray-200">
                Industry key <span className="text-red-600">*</span>
              </div>
              <input
                className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
                value={industryKey}
                onChange={(e) => setIndustryKey(e.target.value)}
                placeholder="marine | auto | hvac | etc"
                disabled={saving}
                autoComplete="off"
              />
            </div>

            {/* URLs */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs text-gray-700 dark:text-gray-200">Redirect URL (optional)</div>
                <input
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
                  value={redirectUrl}
                  onChange={(e) => setRedirectUrl(e.target.value)}
                  placeholder="https://your-site.com/thank-you"
                  disabled={saving}
                  autoComplete="off"
                />
                <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                  Where to send the customer after they submit.
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-700 dark:text-gray-200">Thank-you URL (optional)</div>
                <input
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
                  value={thankYouUrl}
                  onChange={(e) => setThankYouUrl(e.target.value)}
                  placeholder="https://your-site.com/thanks"
                  disabled={saving}
                  autoComplete="off"
                />
                <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                  Alternate final destination (if your flow uses it).
                </div>
              </div>
            </div>

            {/* Reporting */}
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Reporting defaults
                  </div>
                  <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                    Used for weekly metrics on the dashboard.
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs text-gray-700 dark:text-gray-200">
                    Reporting timezone
                  </div>
                  <input
                    className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
                    value={reportingTimezone}
                    onChange={(e) => setReportingTimezone(e.target.value)}
                    placeholder="America/New_York"
                    disabled={saving}
                    autoComplete="off"
                  />
                  <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                    Example: <span className="font-mono">America/New_York</span>,{" "}
                    <span className="font-mono">America/Chicago</span>
                  </div>
                </div>

                <div>
                  <div className="text-xs text-gray-700 dark:text-gray-200">
                    Week starts on
                  </div>
                  <input
                    className="mt-2 w-full rounded-xl border border-gray-200 bg-gray-100 p-3 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
                    value="Monday"
                    readOnly
                  />
                  <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                    Default is Monday (we can make this selectable later).
                  </div>
                </div>
              </div>

              {/* Keep state aligned even though it's locked */}
              <input type="hidden" value={weekStartsOn} readOnly />
            </div>

            {saveErr ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 whitespace-pre-wrap dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
                {saveErr}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={save}
                disabled={!canSave || saving}
                className={cn(
                  "rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90",
                  "dark:bg-white dark:text-black"
                )}
              >
                {saving ? "Saving…" : "Save settings"}
              </button>

              {saved ? (
                <span className="text-sm font-semibold text-green-700 dark:text-green-300">
                  Saved ✅
                </span>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
