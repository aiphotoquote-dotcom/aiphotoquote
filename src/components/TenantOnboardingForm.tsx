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
        redirect_url: string | null;
        thank_you_url: string | null;
        updated_at: string | null;
      } | null;
    }
  | { ok: false; error: any };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function isValidUrlOrEmpty(s: string) {
  const v = (s || "").trim();
  if (!v) return true;
  try {
    // allow https://example.com
    new URL(v);
    return true;
  } catch {
    return false;
  }
}

export default function TenantOnboardingForm({
  redirectToDashboard = false,
}: {
  redirectToDashboard?: boolean;
}) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [tenantSlug, setTenantSlug] = useState<string>("");
  const [tenantName, setTenantName] = useState<string>("");

  const [industryKey, setIndustryKey] = useState<string>("");
  const [redirectUrl, setRedirectUrl] = useState<string>("");
  const [thankYouUrl, setThankYouUrl] = useState<string>("");

  const [openAiKey, setOpenAiKey] = useState<string>("");

  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<boolean>(false);

  async function loadMe() {
    const res = await fetch("/api/tenant/me-settings", { cache: "no-store" });
    const json: MeSettingsResponse = await res.json();

    if (!("ok" in json) || !json.ok) {
      throw new Error("Failed to load tenant settings");
    }

    const t = json.tenant;
    const s = json.settings;

    setTenantSlug(t?.slug ? String(t.slug) : "");
    setTenantName(t?.name ? String(t.name) : "");

    setIndustryKey(s?.industry_key ? String(s.industry_key) : "");
    setRedirectUrl(s?.redirect_url ? String(s.redirect_url) : "");
    setThankYouUrl(s?.thank_you_url ? String(s.thank_you_url) : "");

    return json;
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadMe();
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load settings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const canSave = useMemo(() => {
    if (saving) return false;
    if (!industryKey.trim()) return false;
    if (!isValidUrlOrEmpty(redirectUrl)) return false;
    if (!isValidUrlOrEmpty(thankYouUrl)) return false;
    return true;
  }, [saving, industryKey, redirectUrl, thankYouUrl]);

  async function saveSettingsOnly() {
    const res = await fetch("/api/tenant/save-settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        industry_key: industryKey.trim(),
        redirect_url: redirectUrl.trim() || null,
        thank_you_url: thankYouUrl.trim() || null,
      }),
    });

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Server returned non-JSON (HTTP ${res.status})`);
    }

    if (!res.ok || !json?.ok) {
      const msg = json?.message || json?.error?.message || "Failed to save settings";
      throw new Error(msg);
    }
  }

  async function saveOpenAiKeyIfProvided() {
    const key = openAiKey.trim();
    if (!key) return;

    // This endpoint already exists in your tree.
    const res = await fetch("/api/admin/openai-key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ openaiKey: key }),
    });

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`OpenAI key route returned non-JSON (HTTP ${res.status})`);
    }

    if (!res.ok || !json?.ok) {
      const msg = json?.message || json?.error?.message || "Failed to save OpenAI key";
      throw new Error(msg);
    }
  }

  async function onSave() {
    setError(null);
    setSaved(false);
    setSaving(true);

    try {
      await saveSettingsOnly();
      await saveOpenAiKeyIfProvided();

      // Re-load to confirm what the server considers "complete"
      const me = await loadMe();
      setSaved(true);

      const isComplete = Boolean(me?.ok && (me as any)?.settings?.industry_key);

      if (redirectToDashboard && isComplete) {
        router.push("/dashboard");
        router.refresh();
      }
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold">Tenant</div>
            <div className="mt-1 text-sm text-gray-700">
              {loading ? "Loading…" : tenantName || "—"}
              {tenantSlug ? (
                <span className="ml-2 rounded-full border px-2 py-0.5 text-xs text-gray-700">
                  <span className="font-mono">{tenantSlug}</span>
                </span>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
          >
            Back to dashboard
          </button>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-5 space-y-4">
        <div>
          <div className="text-sm font-semibold">Core settings</div>
          <p className="mt-1 text-xs text-gray-600">
            Industry is required. Redirect URLs are optional.
          </p>
        </div>

        <label className="block">
          <div className="text-xs text-gray-700">
            Industry key <span className="text-red-600">*</span>
          </div>
          <input
            className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm"
            value={industryKey}
            onChange={(e) => setIndustryKey(e.target.value)}
            placeholder="e.g. marine, auto, powersports"
            disabled={loading || saving}
          />
        </label>

        <label className="block">
          <div className="text-xs text-gray-700">Redirect URL (optional)</div>
          <input
            className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm"
            value={redirectUrl}
            onChange={(e) => setRedirectUrl(e.target.value)}
            placeholder="https://your-site.com/after-submit"
            disabled={loading || saving}
          />
          {!isValidUrlOrEmpty(redirectUrl) ? (
            <div className="mt-2 text-xs text-red-600">Enter a valid URL or leave blank.</div>
          ) : null}
        </label>

        <label className="block">
          <div className="text-xs text-gray-700">Thank-you URL (optional)</div>
          <input
            className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm"
            value={thankYouUrl}
            onChange={(e) => setThankYouUrl(e.target.value)}
            placeholder="https://your-site.com/thank-you"
            disabled={loading || saving}
          />
          {!isValidUrlOrEmpty(thankYouUrl) ? (
            <div className="mt-2 text-xs text-red-600">Enter a valid URL or leave blank.</div>
          ) : null}
        </label>
      </div>

      <div className="rounded-2xl border bg-white p-5 space-y-4">
        <div>
          <div className="text-sm font-semibold">Tenant OpenAI key (optional)</div>
          <p className="mt-1 text-xs text-gray-600">
            This is stored encrypted server-side. Leave blank to keep existing.
          </p>
        </div>

        <label className="block">
          <div className="text-xs text-gray-700">OpenAI API key</div>
          <input
            className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm font-mono"
            value={openAiKey}
            onChange={(e) => setOpenAiKey(e.target.value)}
            placeholder="sk-..."
            disabled={loading || saving}
          />
        </label>
      </div>

      <button
        type="button"
        className={cn(
          "w-full rounded-xl bg-black py-4 font-semibold text-white disabled:opacity-50",
          saving ? "opacity-80" : ""
        )}
        onClick={onSave}
        disabled={!canSave}
      >
        {saving ? "Saving…" : "Save settings"}
      </button>

      {saved ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900">
          Saved!
          {redirectToDashboard ? " Redirecting if setup is complete…" : null}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 whitespace-pre-wrap">
          {error}
        </div>
      ) : null}

      <div className="text-xs text-gray-600">
        Tip: once your industry is set, Dashboard will show “Ready” and the public quote link.
      </div>
    </div>
  );
}
