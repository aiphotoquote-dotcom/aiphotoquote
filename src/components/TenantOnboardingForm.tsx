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

        reporting_timezone?: string | null;
        week_starts_on?: number | null;

        updated_at: string | null;
      } | null;
    }
  | { ok: false; error: any; message?: string };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
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

  // ✅ reporting config
  const [reportingTimezone, setReportingTimezone] = useState("America/New_York");
  const [weekStartsOn, setWeekStartsOn] = useState<number>(1);

  const canSave = useMemo(() => {
    return Boolean(tenantSlug.trim().length >= 3 && industryKey.trim().length >= 1);
  }, [tenantSlug, industryKey]);

  function pickStr(s: any, key: string, fallback = "") {
    const v = s?.[key];
    return typeof v === "string" ? v : fallback;
  }

  function pickNum(s: any, key: string, fallback: number) {
    const v = s?.[key];
    return typeof v === "number" ? v : fallback;
  }

  async function load() {
    setLoading(true);
    setLoadErr(null);
    setSaved(false);

    try {
      const res = await fetch("/api/tenant/me-settings", { cache: "no-store" });
      const json: MeSettingsResponse = await res.json();

      if (!("ok" in json) || !json.ok) {
        setLoadErr("Failed to load tenant settings.");
        return;
      }

      setTenantName(json.tenant?.name ?? "");
      setTenantSlug(json.tenant?.slug ?? "");

      const s: any = json.settings;
      setIndustryKey(s?.industry_key ?? "");

      setRedirectUrl(pickStr(s, "redirect_url", ""));
      setThankYouUrl(pickStr(s, "thank_you_url", ""));

      setReportingTimezone(pickStr(s, "reporting_timezone", "America/New_York"));
      setWeekStartsOn(pickNum(s, "week_starts_on", 1));
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

    const payload = {
      tenantSlug: tenantSlug.trim(),
      industry_key: industryKey.trim(),
      redirect_url: redirectUrl.trim() || null,
      thank_you_url: thankYouUrl.trim() || null,

      reporting_timezone: reportingTimezone.trim() || "America/New_York",
      week_starts_on: weekStartsOn,
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
              Tenant settings
            </div>
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              Configure your slug, industry, redirect URLs, and reporting.
            </div>
          </div>

          <button
            type="button"
            onClick={load}
            disabled={loading || saving}
            className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:hover:bg-gray-900"
          >
            Retry
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
          <div className="mt-5 grid gap-4">
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

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs text-gray-700 dark:text-gray-200">
                  Redirect URL (optional)
                </div>
                <input
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
                  value={redirectUrl}
                  onChange={(e) => setRedirectUrl(e.target.value)}
                  placeholder="https://your-site.com/thank-you"
                  disabled={saving}
                  autoComplete="off"
                />
                <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                  Where to send customer after submit.
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-700 dark:text-gray-200">
                  Thank-you URL (optional)
                </div>
                <input
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
                  value={thankYouUrl}
                  onChange={(e) => setThankYouUrl(e.target.value)}
                  placeholder="https://your-site.com/thanks"
                  disabled={saving}
                  autoComplete="off"
                />
                <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                  Alternate final destination (if used by your flow).
                </div>
              </div>
            </div>

            {/* ✅ Reporting settings */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs text-gray-700 dark:text-gray-200">
                  Reporting timezone
                </div>
                <select
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
                  value={reportingTimezone}
                  onChange={(e) => setReportingTimezone(e.target.value)}
                  disabled={saving}
                >
                  <option value="America/New_York">America/New_York</option>
                  <option value="America/Chicago">America/Chicago</option>
                  <option value="America/Denver">America/Denver</option>
                  <option value="America/Los_Angeles">America/Los_Angeles</option>
                  <option value="UTC">UTC</option>
                </select>
                <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                  Controls “this week / last week” windows.
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-700 dark:text-gray-200">
                  Week starts on
                </div>
                <select
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
                  value={weekStartsOn}
                  onChange={(e) => setWeekStartsOn(Number(e.target.value))}
                  disabled={saving}
                >
                  <option value={0}>Sunday</option>
                  <option value={1}>Monday</option>
                  <option value={2}>Tuesday</option>
                  <option value={3}>Wednesday</option>
                  <option value={4}>Thursday</option>
                  <option value={5}>Friday</option>
                  <option value={6}>Saturday</option>
                </select>
                <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                  Weekly comparisons align to this day.
                </div>
              </div>
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
