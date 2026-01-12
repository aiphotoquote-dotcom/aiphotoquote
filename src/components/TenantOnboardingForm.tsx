"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

function Chip({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "good" | "warn";
  children: React.ReactNode;
}) {
  const cls =
    tone === "good"
      ? "border-green-300 bg-green-50 text-green-800"
      : tone === "warn"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-gray-200 bg-white text-gray-700";

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${cls}`}>
      <span className="inline-block h-2 w-2 rounded-full bg-current opacity-60" />
      {children}
    </span>
  );
}

export default function TenantOnboardingForm() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [industryKey, setIndustryKey] = useState("upholstery");

  // OpenAI
  const [openaiKey, setOpenaiKey] = useState("");
  const [hasOpenaiKey, setHasOpenaiKey] = useState<boolean>(false);
  const [keyVerified, setKeyVerified] = useState<boolean>(false);

  // Redirects
  const [redirectUrl, setRedirectUrl] = useState("");
  const [thankYouUrl, setThankYouUrl] = useState("");

  // Pricing
  const [minJob, setMinJob] = useState<number | "">("");
  const [typLow, setTypLow] = useState<number | "">("");
  const [typHigh, setTypHigh] = useState<number | "">("");
  const [maxWOI, setMaxWOI] = useState<number | "">("");

  // UI state
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saved">("idle");

  const suggestedSlug = useMemo(() => slugify(name), [name]);

  // Keep an initial snapshot to know if form is "dirty"
  const initialRef = useRef<string>("");

  function snapshot() {
    return JSON.stringify({
      name,
      slug,
      industryKey,
      redirectUrl: normalizeUrl(redirectUrl),
      thankYouUrl: normalizeUrl(thankYouUrl),
      minJob,
      typLow,
      typHigh,
      maxWOI,
      // NOTE: openaiKey not included in dirty tracking; users may leave it blank
      // and we still want "Save" to work based on other fields.
    });
  }

  // Load current settings once
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setMsg(null);
      setLoading(true);

      try {
        const res = await fetch("/api/tenant/me-settings", { cache: "no-store" });
        const json = await res.json();

        if (cancelled) return;

        if (!json.ok) {
          setMsg(json.error?.message ? `❌ ${json.error.message}` : null);
          return;
        }

        const t = json.tenant ?? {};
        const s = json.settings ?? {};
        const sec = json.secrets ?? {};

        setName(pick<string>(t, ["name"], ""));
        setSlug(pick<string>(t, ["slug"], ""));

        setIndustryKey(pick<string>(s, ["industryKey", "industry_key"], "upholstery"));
        setRedirectUrl(pick<string>(s, ["redirectUrl", "redirect_url"], ""));
        setThankYouUrl(pick<string>(s, ["thankYouUrl", "thank_you_url"], ""));

        setHasOpenaiKey(Boolean(sec?.hasOpenaiKey));
        setKeyVerified(false);
      } catch (e: any) {
        if (!cancelled) setMsg(`❌ ${e?.message || "Failed to load settings"}`);
      } finally {
        if (!cancelled) {
          setLoading(false);
          // set baseline snapshot after load
          const snap = JSON.stringify({
            name: pick<string>((await (async () => ({}))()) as any, [], ""), // no-op to avoid TS lint on hoist
          });
          // We'll set the baseline in a microtask after state settles:
          queueMicrotask(() => {
            if (cancelled) return;
            initialRef.current = snapshot();
            setSaveState("idle");
          });
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track dirty state
  useEffect(() => {
    if (loading) return;
    const isDirty = initialRef.current !== snapshot();
    setSaveState((prev) => {
      if (isDirty) return "dirty";
      return prev === "saved" ? "saved" : "idle";
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, slug, industryKey, redirectUrl, thankYouUrl, minJob, typLow, typHigh, maxWOI, loading]);

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

      setKeyVerified(true);
      setMsg("✅ OpenAI key looks valid");
    } catch (e: any) {
      setKeyVerified(false);
      setMsg(`❌ ${e.message}`);
    } finally {
      setTesting(false);
    }
  }

  async function saveAll() {
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

      // Update “stored key” indicator if user submitted a key
      if (openaiKey) setHasOpenaiKey(true);

      // Reset dirty baseline
      initialRef.current = snapshot();
      setSaveState("saved");

      // Optional: clear the key input so it doesn’t sit there
      setOpenaiKey("");

      setMsg("✅ Settings saved");
    } catch (e: any) {
      setMsg(`❌ ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  const keyStatusTone = hasOpenaiKey ? "good" : "warn";
  const keyStatusText = hasOpenaiKey ? "Key stored" : "Key not set";
  const verifyChip =
    keyVerified ? <Chip tone="good">Verified</Chip> : null;

  return (
    <div className="space-y-6 pb-24">
      {loading && (
        <div className="rounded-2xl border bg-white p-4 text-sm text-gray-600">
          Loading your current settings…
        </div>
      )}

      {/* Business */}
      <section className="rounded-2xl border bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Business</h2>
            <p className="mt-1 text-sm text-gray-600">
              Name, slug, and industry drive your public quote page behavior.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4">
          <label className="grid gap-1">
            <span className="text-sm font-medium">Business name</span>
            <input
              className="border rounded-xl p-3"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Maggio Upholstery"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-medium">Tenant slug</span>
            <input
              className="border rounded-xl p-3"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder={suggestedSlug || "your-slug"}
            />
            <span className="text-xs text-gray-600">
              Public quote page:{" "}
              <code className="rounded-md bg-gray-50 px-2 py-1">
                /q/{slug || suggestedSlug || "your-slug"}
              </code>
            </span>
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-medium">Industry</span>
            <select
              className="border rounded-xl p-3"
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
      <section className="rounded-2xl border bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">OpenAI</h2>
            <p className="mt-1 text-sm text-gray-600">
              Store a key once. We never display it back.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Chip tone={keyStatusTone as any}>{keyStatusText}</Chip>
            {verifyChip}
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          <label className="grid gap-1">
            <span className="text-sm font-medium">API key</span>
            <input
              className="border rounded-xl p-3"
              value={openaiKey}
              onChange={(e) => {
                setOpenaiKey(e.target.value);
                setKeyVerified(false);
              }}
              placeholder={hasOpenaiKey ? "•••••••••••••••• (stored)" : "sk-..."}
            />
            <span className="text-xs text-gray-600">
              Paste a new key to replace the stored one.
            </span>
          </label>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button
              className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50"
              onClick={testKey}
              disabled={testing || !openaiKey}
            >
              {testing ? "Testing..." : "Test key"}
            </button>

            <p className="text-xs text-gray-500">
              Tip: Test verifies the key you entered. Save stores it for future requests.
            </p>
          </div>

          {msg && <p className="text-sm whitespace-pre-wrap">{msg}</p>}
        </div>
      </section>

      {/* Pricing */}
      <section className="rounded-2xl border bg-white p-6">
        <div>
          <h2 className="text-lg font-semibold">Pricing guardrails</h2>
          <p className="mt-1 text-sm text-gray-600">
            Keep AI output aligned with how your shop actually prices work.
          </p>
        </div>

        <div className="mt-5 grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-sm font-medium">Minimum job ($)</span>
              <input
                className="border rounded-xl p-3"
                inputMode="numeric"
                value={minJob}
                onChange={(e) => setMinJob(e.target.value === "" ? "" : Number(e.target.value))}
              />
            </label>

            <label className="grid gap-1">
              <span className="text-sm font-medium">Max w/o inspection ($)</span>
              <input
                className="border rounded-xl p-3"
                inputMode="numeric"
                value={maxWOI}
                onChange={(e) => setMaxWOI(e.target.value === "" ? "" : Number(e.target.value))}
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-sm font-medium">Typical low ($)</span>
              <input
                className="border rounded-xl p-3"
                inputMode="numeric"
                value={typLow}
                onChange={(e) => setTypLow(e.target.value === "" ? "" : Number(e.target.value))}
              />
            </label>

            <label className="grid gap-1">
              <span className="text-sm font-medium">Typical high ($)</span>
              <input
                className="border rounded-xl p-3"
                inputMode="numeric"
                value={typHigh}
                onChange={(e) => setTypHigh(e.target.value === "" ? "" : Number(e.target.value))}
              />
            </label>
          </div>
        </div>
      </section>

      {/* Redirects */}
      <section className="rounded-2xl border bg-white p-6">
        <div>
          <h2 className="text-lg font-semibold">Redirects</h2>
          <p className="mt-1 text-sm text-gray-600">
            Send customers where you want after submitting a quote request.
          </p>
        </div>

        <div className="mt-5 grid gap-4">
          <label className="grid gap-1">
            <span className="text-sm font-medium">Redirect after quote</span>
            <input
              className="border rounded-xl p-3"
              value={redirectUrl}
              onChange={(e) => setRedirectUrl(e.target.value)}
              onBlur={() => setRedirectUrl(normalizeUrl(redirectUrl))}
              placeholder="https://maggioupholstery.com"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-medium">Thank you page (optional)</span>
            <input
              className="border rounded-xl p-3"
              value={thankYouUrl}
              onChange={(e) => setThankYouUrl(e.target.value)}
              onBlur={() => setThankYouUrl(normalizeUrl(thankYouUrl))}
              placeholder="https://your-site.com/quote-received"
            />
          </label>
        </div>
      </section>

      {/* Sticky Save Bar */}
      <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="text-sm">
            {saveState === "dirty" && (
              <span className="font-semibold text-gray-800">Unsaved changes</span>
            )}
            {saveState === "saved" && (
              <span className="font-semibold text-green-700">Saved</span>
            )}
            {saveState === "idle" && (
              <span className="text-gray-600">Settings</span>
            )}
            <span className="ml-3 text-xs text-gray-500">
              {hasOpenaiKey ? "OpenAI key stored" : "No OpenAI key stored"}
              {keyVerified ? " • Key verified" : ""}
            </span>
          </div>

          <button
            className="rounded-2xl bg-black px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
            onClick={saveAll}
            disabled={saving || !name}
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
