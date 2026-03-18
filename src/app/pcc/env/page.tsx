// src/app/pcc/env/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

export const runtime = "nodejs";

type BannerTone = "info" | "success" | "warning" | "danger";
type SiteMode = "marketing_live" | "coming_soon";

type PlatformConfigResp =
  | {
      ok: true;
      config: {
        aiQuotingEnabled: boolean;
        aiRenderingEnabled: boolean;

        siteMode: SiteMode;
        siteModePayload: Record<string, any> | null;

        adminBannerEnabled: boolean;
        adminBannerText: string | null;
        adminBannerTone: BannerTone;
        adminBannerHref: string | null;
        adminBannerCtaLabel: string | null;

        maintenanceEnabled: boolean;
        maintenanceMessage: string | null;
      };
    }
  | { ok: false; error: string; message?: string };

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function Card({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-gray-800 dark:bg-gray-950">
      <div>
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</div>
        {desc ? <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">{desc}</div> : null}
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-800 dark:text-gray-200">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-white/5 dark:text-white"
      />
    </div>
  );
}

function Area({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-800 dark:text-gray-200">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={4}
        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-white/5 dark:text-white"
      />
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
      <div>
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</div>
        {hint ? <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">{hint}</div> : null}
      </div>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4" />
    </label>
  );
}

async function safeJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(`Expected JSON but got "${ct || "unknown"}". ${text.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

function val(payload: Record<string, any> | null | undefined, key: string, fallback = "") {
  const raw = payload?.[key];
  return raw == null ? fallback : String(raw);
}

export default function PccEnvPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [aiQuotingEnabled, setAiQuotingEnabled] = useState(true);
  const [aiRenderingEnabled, setAiRenderingEnabled] = useState(false);

  const [siteMode, setSiteMode] = useState<SiteMode>("marketing_live");
  const [siteEyebrow, setSiteEyebrow] = useState("Launching Summer 2026");
  const [siteHeadline, setSiteHeadline] = useState("AI Photo Quote is getting ready.");
  const [siteSubheadline, setSiteSubheadline] = useState(
    "A smarter quoting platform for service businesses is on the way."
  );
  const [sitePrimaryCtaLabel, setSitePrimaryCtaLabel] = useState("Request an invite");
  const [sitePrimaryCtaHref, setSitePrimaryCtaHref] = useState("mailto:hello@aiphotoquote.com");
  const [siteSecondaryCtaLabel, setSiteSecondaryCtaLabel] = useState("Invited pilot? Sign in");
  const [siteSecondaryCtaHref, setSiteSecondaryCtaHref] = useState("/sign-in");
  const [siteLaunchLabel, setSiteLaunchLabel] = useState("Summer 2026");

  const [adminBannerEnabled, setAdminBannerEnabled] = useState(false);
  const [adminBannerText, setAdminBannerText] = useState("");
  const [adminBannerTone, setAdminBannerTone] = useState<BannerTone>("info");
  const [adminBannerHref, setAdminBannerHref] = useState("");
  const [adminBannerCtaLabel, setAdminBannerCtaLabel] = useState("");

  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState("");

  async function load() {
    setErr(null);
    setMsg(null);
    setLoading(true);

    try {
      const res = await fetch("/api/pcc/env", { cache: "no-store" });
      const data = await safeJson<PlatformConfigResp>(res);

      if (!data.ok) throw new Error(data.message || data.error || "Failed to load config");

      const cfg = data.config;
      const payload = cfg.siteModePayload ?? null;

      setAiQuotingEnabled(Boolean(cfg.aiQuotingEnabled));
      setAiRenderingEnabled(Boolean(cfg.aiRenderingEnabled));

      setSiteMode(cfg.siteMode);
      setSiteEyebrow(val(payload, "eyebrow", "Launching Summer 2026"));
      setSiteHeadline(val(payload, "headline", "AI Photo Quote is getting ready."));
      setSiteSubheadline(
        val(payload, "subheadline", "A smarter quoting platform for service businesses is on the way.")
      );
      setSitePrimaryCtaLabel(val(payload, "primaryCtaLabel", "Request an invite"));
      setSitePrimaryCtaHref(val(payload, "primaryCtaHref", "mailto:hello@aiphotoquote.com"));
      setSiteSecondaryCtaLabel(val(payload, "secondaryCtaLabel", "Invited pilot? Sign in"));
      setSiteSecondaryCtaHref(val(payload, "secondaryCtaHref", "/sign-in"));
      setSiteLaunchLabel(val(payload, "launchLabel", "Summer 2026"));

      setAdminBannerEnabled(Boolean(cfg.adminBannerEnabled));
      setAdminBannerText(cfg.adminBannerText ?? "");
      setAdminBannerTone(cfg.adminBannerTone ?? "info");
      setAdminBannerHref(cfg.adminBannerHref ?? "");
      setAdminBannerCtaLabel(cfg.adminBannerCtaLabel ?? "");

      setMaintenanceEnabled(Boolean(cfg.maintenanceEnabled));
      setMaintenanceMessage(cfg.maintenanceMessage ?? "");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setErr(null);
    setMsg(null);

    try {
      const payload = {
        aiQuotingEnabled,
        aiRenderingEnabled,

        siteMode,
        siteModePayload: {
          eyebrow: siteEyebrow.trim(),
          headline: siteHeadline.trim(),
          subheadline: siteSubheadline.trim(),
          primaryCtaLabel: sitePrimaryCtaLabel.trim(),
          primaryCtaHref: sitePrimaryCtaHref.trim(),
          secondaryCtaLabel: siteSecondaryCtaLabel.trim(),
          secondaryCtaHref: siteSecondaryCtaHref.trim(),
          launchLabel: siteLaunchLabel.trim(),
        },

        adminBannerEnabled,
        adminBannerText: adminBannerText.trim() || null,
        adminBannerTone,
        adminBannerHref: adminBannerHref.trim() || null,
        adminBannerCtaLabel: adminBannerCtaLabel.trim() || null,

        maintenanceEnabled,
        maintenanceMessage: maintenanceMessage.trim() || null,
      };

      const res = await fetch("/api/pcc/env", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await safeJson<any>(res);
      if (!data?.ok) throw new Error(data?.message || data?.error || "Failed to save");

      setMsg("Environment controls saved.");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const bannerPreviewClass = useMemo(() => {
    if (adminBannerTone === "success") {
      return "border-green-200 bg-green-50 text-green-800 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-200";
    }
    if (adminBannerTone === "warning") {
      return "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-950/30 dark:text-yellow-100";
    }
    if (adminBannerTone === "danger") {
      return "border-red-200 bg-red-50 text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200";
    }
    return "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-200";
  }, [adminBannerTone]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">Environment</div>
        <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Platform-wide public-site controls, admin banner controls, and maintenance controls.
        </div>

        {msg ? <div className="mt-3 text-sm text-green-700 dark:text-green-300">{msg}</div> : null}
        {err ? <div className="mt-3 text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap">{err}</div> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Global AI switches" desc="Platform-wide safety toggles.">
          <div className="grid gap-3">
            <Toggle
              label="AI quoting enabled"
              checked={aiQuotingEnabled}
              onChange={setAiQuotingEnabled}
              hint="Disables quote submission AI globally if turned off."
            />
            <Toggle
              label="AI rendering enabled"
              checked={aiRenderingEnabled}
              onChange={setAiRenderingEnabled}
              hint="Global render capability baseline."
            />
          </div>
        </Card>

        <Card title="Admin maintenance lockout" desc="Blocks normal admin access while leaving PCC available to platform operators.">
          <div className="grid gap-3">
            <Toggle
              label="Maintenance enabled"
              checked={maintenanceEnabled}
              onChange={setMaintenanceEnabled}
              hint="Non-platform users are shown a maintenance screen in /admin."
            />
            <Area
              label="Maintenance message"
              value={maintenanceMessage}
              onChange={setMaintenanceMessage}
              placeholder="We’re performing scheduled maintenance. Please check back shortly."
            />
          </div>
        </Card>
      </div>

      <Card title="Public website mode" desc="Control what aiphotoquote.com shows without code changes.">
        <div className="grid gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-800 dark:text-gray-200">Site mode</label>
            <select
              value={siteMode}
              onChange={(e) => setSiteMode(e.target.value as SiteMode)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              <option value="marketing_live">marketing_live</option>
              <option value="coming_soon">coming_soon</option>
            </select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Eyebrow" value={siteEyebrow} onChange={setSiteEyebrow} />
            <Field label="Launch label" value={siteLaunchLabel} onChange={setSiteLaunchLabel} />
          </div>

          <Field label="Headline" value={siteHeadline} onChange={setSiteHeadline} />
          <Area label="Subheadline" value={siteSubheadline} onChange={setSiteSubheadline} />

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Primary CTA label" value={sitePrimaryCtaLabel} onChange={setSitePrimaryCtaLabel} />
            <Field label="Primary CTA href" value={sitePrimaryCtaHref} onChange={setSitePrimaryCtaHref} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Secondary CTA label" value={siteSecondaryCtaLabel} onChange={setSiteSecondaryCtaLabel} />
            <Field label="Secondary CTA href" value={siteSecondaryCtaHref} onChange={setSiteSecondaryCtaHref} />
          </div>
        </div>
      </Card>

      <Card title="Admin top-nav banner" desc="Informational banner displayed across admin pages when enabled.">
        <div className="grid gap-4">
          <Toggle
            label="Banner enabled"
            checked={adminBannerEnabled}
            onChange={setAdminBannerEnabled}
            hint="Good for beta notices, maintenance heads-up, or feature announcements."
          />

          <Area label="Banner text" value={adminBannerText} onChange={setAdminBannerText} />
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-gray-800 dark:text-gray-200">Tone</label>
              <select
                value={adminBannerTone}
                onChange={(e) => setAdminBannerTone(e.target.value as BannerTone)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-white/5 dark:text-white"
              >
                <option value="info">info</option>
                <option value="success">success</option>
                <option value="warning">warning</option>
                <option value="danger">danger</option>
              </select>
            </div>

            <Field label="CTA label" value={adminBannerCtaLabel} onChange={setAdminBannerCtaLabel} />
            <Field label="CTA href" value={adminBannerHref} onChange={setAdminBannerHref} />
          </div>

          <div className={cx("rounded-xl border p-3 text-sm", bannerPreviewClass)}>
            <div className="font-semibold">Preview</div>
            <div className="mt-1">{adminBannerText || "Your admin banner text will preview here."}</div>
            {adminBannerEnabled && adminBannerCtaLabel && adminBannerHref ? (
              <div className="mt-2 text-xs font-semibold underline">
                {adminBannerCtaLabel} → {adminBannerHref}
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={load}
          disabled={loading || saving}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:hover:bg-white/10"
        >
          {loading ? "Loading…" : "Reload"}
        </button>

        <button
          type="button"
          onClick={save}
          disabled={loading || saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-400"
        >
          {saving ? "Saving…" : "Save Environment"}
        </button>
      </div>
    </div>
  );
}
