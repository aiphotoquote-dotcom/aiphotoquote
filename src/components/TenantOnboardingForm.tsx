"use client";

import { useEffect, useMemo, useState } from "react";

const INDUSTRIES = [
  { key: "upholstery", name: "Upholstery" },
  { key: "pressure_washing", name: "Pressure Washing" },
  { key: "flooring", name: "Flooring" },
  { key: "roofing_repairs", name: "Roofing (Repairs)" },
  { key: "auto_body", name: "Auto Body / Paint" },
  { key: "other", name: "Other" },
];

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

/** Ensures URLs pass Zod .url() validation */
function normalizeUrl(u: string) {
  const s = (u ?? "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) return `https://${s}`;
  return s;
}

function pick<T = any>(obj: any, keys: string[], fallback: T): T {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null) return v as T;
  }
  return fallback;
}

export default function TenantOnboardingForm() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [industryKey, setIndustryKey] = useState("upholstery");

  const [openaiKey, setOpenaiKey] = useState("");

  const [redirectUrl, setRedirectUrl] = useState("");
  const [thankYouUrl, setThankYouUrl] = useState("");

  const [minJob, setMinJob] = useState<number | "">("");
  const [typLow, setTypLow] = useState<number | "">("");
  const [typHigh, setTypHigh] = useState<number | "">("");
  const [maxWOI, setMaxWOI] = useState<number | "">("");

  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const suggestedSlug = useMemo(() => slugify(name), [name]);

  // Load existing tenant/settings once
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setMsg(null);
      setLoading(true);

      try {
        const res = await fetch("/api/tenant/me-settings", { cache: "no-store" });
        const json = await res.json();

        if (!json.ok) {
          // If tenant isn't found yet, keep form empty.
          if (!cancelled) setMsg(json.error?.message ? `❌ ${json.error.message}` : null);
          return;
        }

        const t = json.tenant ?? {};
        const s = json.settings ?? {};

        if (cancelled) return;

        // tenant
        setName(pick<string>(t, ["name"], ""));
        setSlug(pick<string>(t, ["slug"], ""));

        // settings (support snake_case from route)
        setIndustryKey(pick<string>(s, ["industryKey", "industry_key"], "upholstery"));
        setRedirectUrl(pick<string>(s, ["redirectUrl", "redirect_url"], ""));
        setThankYouUrl(pick<string>(s, ["thankYouUrl", "thank_you_url"], ""));
      } catch (e: any) {
        if (!cancelled) setMsg(`❌ ${e?.message || "Failed to load settings"}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function testKey() {
    setMsg(null);
    setTesting(true);
    try {
      const res = await fetch("/api/tenant/test-openai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ openaiKey }),
      });

      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message ?? "Key test failed");

      setMsg("✅ OpenAI key looks good");
    } catch (e: any) {
      setMsg(`❌ ${e.message}`);
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setMsg(null);
    setSaving(true);

    try {
      const payload = {
        tenant: {
          name,
          slug: slug || suggestedSlug,
        },
        industryKey,
        openaiKey: openaiKey || undefined,
        redirects: {
          redirectUrl: normalizeUrl(redirectUrl) || undefined,
          thankYouUrl: normalizeUrl(thankYouUrl) || undefined,
        },
        pricing: {
          minJob: minJob === "" ? undefined : Number(minJob),
          typicalLow: typLow === "" ? undefined : Number(typLow),
          typicalHigh: typHigh === "" ? undefined : Number(typHigh),
          maxWithoutInspection: maxWOI === "" ? undefined : Number(maxWOI),
          tone: "value",
          riskPosture: "conservative",
          alwaysEstimateLanguage: true,
        },
      };

      const res = await fetch("/api/tenant/save-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!json.ok) {
        const detail =
          json.error?.details
            ? JSON.stringify(json.error.details, null, 2)
            : json.error?.message ?? "Save failed";
        throw new Error(detail);
      }

      // Refresh local state from response (support either shape)
      const t = json.tenant ?? {};
      const s = json.settings ?? {};

      setName(pick<string>(t, ["name"], name));
      setSlug(pick<string>(t, ["slug"], slug || suggestedSlug));

      setIndustryKey(pick<string>(s, ["industryKey", "industry_key"], industryKey));
      setRedirectUrl(pick<string>(s, ["redirectUrl", "redirect_url"], redirectUrl));
      setThankYouUrl(pick<string>(s, ["thankYouUrl", "thank_you_url"], thankYouUrl));

      setMsg("✅ Settings saved");
    } catch (e: any) {
      setMsg(`❌ ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {loading && (
        <div className="rounded-xl border p-4 text-sm text-gray-600">
          Loading your current settings…
        </div>
      )}

      {/* Business */}
      <section className="rounded-xl border p-5">
        <h2 className="font-semibold">Business</h2>

        <div className="mt-4 grid gap-3">
          <label className="grid gap-1">
            <span className="text-sm">Business name</span>
            <input
              className="border rounded-md p-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Maggio Upholstery"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm">Tenant slug</span>
            <input
              className="border rounded-md p-2"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder={suggestedSlug || "your-slug"}
            />
            <span className="text-xs text-gray-600">
              Public quote page: <code>/q/{slug || suggestedSlug || "your-slug"}</code>
            </span>
          </label>

          <label className="grid gap-1">
            <span className="text-sm">Industry</span>
            <select
              className="border rounded-md p-2"
              value={industryKey}
              onChange={(e) => setIndustryKey(e.target.value)}
            >
              {INDUSTRIES.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* OpenAI */}
      <section className="rounded-xl border p-5">
        <h2 className="font-semibold">OpenAI Key</h2>

        <div className="mt-4 grid gap-3">
          <label className="grid gap-1">
            <span className="text-sm">API Key</span>
            <input
              className="border rounded-md p-2"
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              placeholder="sk-..."
            />
          </label>

          <div className="flex gap-3">
            <button
              className="rounded-md border px-4 py-2 disabled:opacity-50"
              onClick={testKey}
              disabled={testing || !openaiKey}
            >
              {testing ? "Testing..." : "Test Key"}
            </button>

            <button
              className="rounded-md bg-black text-white px-4 py-2 disabled:opacity-50"
              onClick={save}
              disabled={saving || !name}
            >
              {saving ? "Saving..." : "Save Settings"}
            </button>
          </div>

          {msg && <p className="text-sm whitespace-pre-wrap">{msg}</p>}
        </div>
      </section>

      {/* Pricing */}
      <section className="rounded-xl border p-5">
        <h2 className="font-semibold">Pricing Guardrails</h2>

        <div className="mt-4 grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1">
              <span className="text-sm">Minimum job ($)</span>
              <input
                className="border rounded-md p-2"
                inputMode="numeric"
                value={minJob}
                onChange={(e) =>
                  setMinJob(e.target.value === "" ? "" : Number(e.target.value))
                }
              />
            </label>

            <label className="grid gap-1">
              <span className="text-sm">Max w/o inspection ($)</span>
              <input
                className="border rounded-md p-2"
                inputMode="numeric"
                value={maxWOI}
                onChange={(e) =>
                  setMaxWOI(e.target.value === "" ? "" : Number(e.target.value))
                }
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1">
              <span className="text-sm">Typical low ($)</span>
              <input
                className="border rounded-md p-2"
                inputMode="numeric"
                value={typLow}
                onChange={(e) =>
                  setTypLow(e.target.value === "" ? "" : Number(e.target.value))
                }
              />
            </label>

            <label className="grid gap-1">
              <span className="text-sm">Typical high ($)</span>
              <input
                className="border rounded-md p-2"
                inputMode="numeric"
                value={typHigh}
                onChange={(e) =>
                  setTypHigh(e.target.value === "" ? "" : Number(e.target.value))
                }
              />
            </label>
          </div>
        </div>
      </section>

      {/* Redirects */}
      <section className="rounded-xl border p-5">
        <h2 className="font-semibold">Redirects</h2>

        <div className="mt-4 grid gap-3">
          <label className="grid gap-1">
            <span className="text-sm">Redirect after quote</span>
            <input
              className="border rounded-md p-2"
              value={redirectUrl}
              onChange={(e) => setRedirectUrl(e.target.value)}
              onBlur={() => setRedirectUrl(normalizeUrl(redirectUrl))}
              placeholder="https://maggioupholstery.com"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm">Thank you page (optional)</span>
            <input
              className="border rounded-md p-2"
              value={thankYouUrl}
              onChange={(e) => setThankYouUrl(e.target.value)}
              onBlur={() => setThankYouUrl(normalizeUrl(thankYouUrl))}
              placeholder="https://your-site.com/quote-received"
            />
          </label>
        </div>
      </section>
    </div>
  );
}
