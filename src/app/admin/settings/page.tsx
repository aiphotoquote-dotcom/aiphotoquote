"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

/* =======================
   Types
======================= */

type TenantRow = {
  tenantId: string;
  slug: string;
  name: string | null;
  role: "owner" | "admin" | "member";
};

type ContextResp =
  | { ok: true; activeTenantId: string | null; tenants: TenantRow[] }
  | { ok: false; error: string; message?: string };

type SettingsResp =
  | {
      ok: true;
      tenantId: string;
      role: "owner" | "admin" | "member";
      settings: {
        business_name: string;
        lead_to_email: string;
        resend_from_email: string;

        brand_logo_url?: string | null;

        email_send_mode?: "standard" | "enterprise" | null;
        email_identity_id?: string | null;
      };
    }
  | { ok: false; error: string; message?: string; issues?: any };

type EmailStatusResp =
  | {
      ok: true;
      enabled: boolean;
      platform: { resend_key_present: boolean };
      tenant: {
        business_name_present: boolean;
        lead_to_email_present: boolean;
        resend_from_email_present: boolean;

        email_send_mode?: "standard" | "enterprise";
        email_identity_id_present?: boolean;
      };
      notes: string[];
    }
  | { ok: false; error: string; message?: string };

// NEW: Branded Email status (server-derived; safe to be "not implemented yet")
type BrandedEmailStatusResp =
  | {
      ok: true;
      mode: "standard" | "enterprise";
      fromRequested: string | null; // tenant resend_from_email (raw)
      fromUsed: string | null; // what standard mode would actually use (after fallback decision)
      replyTo: string | null; // lead_to_email
      status: "verified" | "not_verified" | "missing_from" | "missing_reply_to" | "unknown";
      usingFallback: boolean;
      fallbackFrom: string | null; // platform sender (e.g., aiphotoquote.com)
      notes: string[];
    }
  | { ok: false; error: string; message?: string };

/* =======================
   Helpers
======================= */

async function safeJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Expected JSON but got "${ct || "unknown"}" (status ${res.status}). ` +
        `First 80 chars: ${text.slice(0, 80)}`
    );
  }
  return (await res.json()) as T;
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function extractDomainFromFromLine(fromLine: string): string | null {
  const s = String(fromLine || "").trim();
  if (!s) return null;

  // Handles: "Name <email@domain.com>" or "email@domain.com"
  const mAngle = s.match(/<([^>]+)>/);
  const email = (mAngle?.[1] || s).trim();

  const at = email.lastIndexOf("@");
  if (at === -1) return null;

  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

function prettyDomain(fromLine: string): string {
  return extractDomainFromFromLine(fromLine) || "unknown";
}

/* =======================
   UI Primitives
======================= */

function Pill(props: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const tone = props.tone ?? "neutral";
  const cls =
    tone === "good"
      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-200"
      : tone === "warn"
      ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-900/20 dark:text-yellow-100"
      : tone === "bad"
      ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200"
      : "border-gray-200 bg-white text-gray-700 dark:border-white/10 dark:bg-white/5 dark:text-gray-200";

  return (
    <span className={cx("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium", cls)}>
      {props.children}
    </span>
  );
}

function Card(props: { title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-neutral-950/40">
      <div className="flex items-start justify-between gap-4 border-b border-gray-100 p-5 dark:border-white/10">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-white">{props.title}</div>
          {props.subtitle ? <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">{props.subtitle}</div> : null}
        </div>
        {props.right ? <div className="shrink-0">{props.right}</div> : null}
      </div>
      <div className="p-5">{props.children}</div>
    </div>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  inputType?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-800 dark:text-gray-200">{props.label}</label>
      <input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
        placeholder={props.placeholder}
        type={props.inputType ?? "text"}
        className={cx(
          "mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none transition",
          "border-gray-300 bg-white text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20",
          "disabled:cursor-not-allowed disabled:bg-gray-100",
          "dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-gray-400",
          "dark:focus:border-blue-400 dark:focus:ring-blue-400/20 dark:disabled:bg-white/5"
        )}
      />
      {props.hint ? <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{props.hint}</p> : null}
    </div>
  );
}

function SmallButton(props: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  tone?: "primary" | "neutral";
}) {
  const tone = props.tone ?? "neutral";
  const cls =
    tone === "primary"
      ? cx(
          "rounded-lg px-3 py-2 text-sm font-semibold transition",
          "bg-black text-white hover:opacity-90 disabled:opacity-50",
          "dark:bg-white dark:text-black dark:hover:opacity-90"
        )
      : cx(
          "rounded-lg border px-3 py-2 text-sm font-semibold transition",
          "border-gray-300 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-50",
          "dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:hover:bg-white/10"
        );

  return (
    <button type="button" onClick={props.onClick} disabled={props.disabled} title={props.title} className={cls}>
      {props.children}
    </button>
  );
}

/* =======================
   Page Component
======================= */

export default function AdminTenantSettingsPage() {
  /* ---------- context ---------- */
  const [context, setContext] = useState<{ activeTenantId: string | null; tenants: TenantRow[] }>({
    activeTenantId: null,
    tenants: [],
  });

  const [role, setRole] = useState<"owner" | "admin" | "member" | null>(null);

  /* ---------- branding ---------- */
  const [businessName, setBusinessName] = useState("");
  const [leadToEmail, setLeadToEmail] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [brandLogoUrl, setBrandLogoUrl] = useState("");

  /* ---------- email ---------- */
  const [emailSendMode, setEmailSendMode] = useState<"standard" | "enterprise">("standard");
  const [emailIdentityId, setEmailIdentityId] = useState("");
  const [emailStatus, setEmailStatus] = useState<EmailStatusResp | null>(null);

  // NEW: branded email status (safe to be null / unknown)
  const [brandedStatus, setBrandedStatus] = useState<BrandedEmailStatusResp | null>(null);
  const [loadingBranded, setLoadingBranded] = useState(false);

  /* ---------- ui ---------- */
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const canEdit = useMemo(() => role === "owner" || role === "admin", [role]);

  const CONTEXT_URL = "/api/tenant/context";
  const SETTINGS_URL = "/api/admin/tenant-settings";
  const EMAIL_STATUS_URL = "/api/admin/email/status";

  // NEW endpoint to be implemented next commit
  const BRANDED_STATUS_URL = "/api/admin/email/branded-status";

  const tenants = useMemo(() => (Array.isArray(context?.tenants) ? context.tenants : []), [context]);

  const activeTenantId = context?.activeTenantId ?? null;

  const activeTenant = useMemo(() => {
    if (!activeTenantId) return null;
    return tenants.find((t) => t.tenantId === activeTenantId) || null;
  }, [tenants, activeTenantId]);

  const brandLogoUrlStr = brandLogoUrl;
  const hasBrandLogo = (brandLogoUrl ?? "").trim().length > 0;

  async function loadContext() {
    const res = await fetch(CONTEXT_URL, { cache: "no-store" });
    const data = await safeJson<ContextResp>(res);
    if (!data.ok) throw new Error(data.message || data.error || "Failed to load tenant context");

    setContext({
      activeTenantId: data.activeTenantId ?? null,
      tenants: Array.isArray(data.tenants) ? data.tenants : [],
    });

    return data.activeTenantId ?? null;
  }

  async function loadSettings() {
    const res = await fetch(SETTINGS_URL, { cache: "no-store" });
    const data = await safeJson<SettingsResp>(res);
    if (!data.ok) throw new Error(data.message || data.error || "Failed to load settings");

    setRole(data.role);

    setBusinessName(data.settings.business_name || "");
    setLeadToEmail(data.settings.lead_to_email || "");
    setFromEmail(data.settings.resend_from_email || "");

    setBrandLogoUrl((data.settings.brand_logo_url ?? "").toString());

    const modeRaw = String(data.settings.email_send_mode ?? "").trim().toLowerCase();
    setEmailSendMode(modeRaw === "enterprise" ? "enterprise" : "standard");

    setEmailIdentityId((data.settings.email_identity_id ?? "").toString());
  }

  async function loadEmailStatus() {
    const res = await fetch(EMAIL_STATUS_URL, { cache: "no-store" });
    const data = await safeJson<EmailStatusResp>(res);
    setEmailStatus(data);
  }

  async function loadBrandedEmailStatus() {
    setLoadingBranded(true);
    try {
      const res = await fetch(BRANDED_STATUS_URL, { cache: "no-store" });

      // If endpoint isn't built yet, don't throw — show "unknown" gracefully
      if (res.status === 404) {
        setBrandedStatus({
          ok: true,
          mode: emailSendMode,
          fromRequested: fromEmail.trim() || null,
          fromUsed: null,
          replyTo: leadToEmail.trim() || null,
          status: "unknown",
          usingFallback: false,
          fallbackFrom: null,
          notes: ["Branded Email status endpoint not wired yet (next commit)."],
        });
        return;
      }

      const data = await safeJson<BrandedEmailStatusResp>(res);
      setBrandedStatus(data);
    } catch (e: any) {
      setBrandedStatus({
        ok: true,
        mode: emailSendMode,
        fromRequested: fromEmail.trim() || null,
        fromUsed: null,
        replyTo: leadToEmail.trim() || null,
        status: "unknown",
        usingFallback: false,
        fallbackFrom: null,
        notes: [`Unable to load Branded Email status: ${e?.message ?? String(e)}`],
      });
    } finally {
      setLoadingBranded(false);
    }
  }

  async function bootstrap() {
    setErr(null);
    setMsg(null);
    setLoading(true);

    try {
      const id = await loadContext();
      if (!id) {
        setRole(null);
        setEmailStatus(null);
        setBrandedStatus(null);
        setMsg(null);
        setErr("No tenants found for this user yet.");
        return;
      }

      await loadSettings();
      await loadEmailStatus();
      await loadBrandedEmailStatus();

      setMsg("Loaded.");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setEmailStatus(null);
      setBrandedStatus(null);
    } finally {
      setLoading(false);
    }
  }

  async function switchTenant(tenantId: string) {
    setErr(null);
    setMsg(null);
    setLoading(true);

    try {
      const res = await fetch(CONTEXT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });

      const data = await safeJson<any>(res);
      if (!data?.ok) throw new Error(data?.message || data?.error || "Failed to switch tenant");

      await bootstrap();
      setMsg("Switched tenant.");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setLoading(false);
    }
  }

  /* ---------- test email ---------- */
  const [testEmailRes, setTestEmailRes] = useState<any>(null);
  const [testingEmail, setTestingEmail] = useState(false);

  async function sendTestEmail() {
    setTestingEmail(true);
    setTestEmailRes(null);
    setErr(null);
    setMsg(null);

    try {
      const res = await fetch("/api/admin/email/test", { method: "POST" });
      const data = await safeJson<any>(res);
      setTestEmailRes(data);
      if (data?.ok) setMsg("Test email sent.");
      else setErr(data?.error || data?.message || "Test email failed.");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setTestingEmail(false);
    }
  }

  /* ---------- logo upload ---------- */
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoErr, setLogoErr] = useState<string | null>(null);

  async function uploadLogo(file: File) {
    const fd = new FormData();
    fd.append("file", file);

    const res = await fetch("/api/admin/tenant-logo/upload", {
      method: "POST",
      body: fd,
    });

    const ct = res.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await res.json() : { ok: false, error: await res.text() };

    if (!data?.ok) throw new Error(data?.message || data?.error || "Upload failed");
    return data.url as string;
  }

  async function onPickLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setLogoErr(null);
    setUploadingLogo(true);
    setMsg(null);
    setErr(null);

    try {
      const url = await uploadLogo(file);
      setBrandLogoUrl(url);
      setMsg("Logo uploaded. Click Save Settings to apply.");
    } catch (ex: any) {
      setLogoErr(ex?.message ?? String(ex));
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  /* ---------- save ---------- */
  async function save() {
    setErr(null);
    setLogoErr(null);
    setMsg(null);
    setSaving(true);

    try {
      const payload = {
        business_name: businessName.trim(),
        lead_to_email: leadToEmail.trim(),
        resend_from_email: fromEmail.trim(),

        brand_logo_url: (brandLogoUrl ?? "").trim() ? (brandLogoUrl ?? "").trim() : null,

        email_send_mode: emailSendMode,
        email_identity_id: emailIdentityId.trim() || null,
      };

      const res = await fetch(SETTINGS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await safeJson<SettingsResp>(res);
      if (!data.ok) throw new Error(data.message || data.error || "Failed to save settings");

      setRole(data.role);
      await loadEmailStatus();
      await loadBrandedEmailStatus();
      setMsg("Saved.");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusMode = emailStatus?.ok ? (emailStatus.tenant.email_send_mode ?? "standard") : "standard";
  const enterpriseIdentityPresent = emailStatus?.ok ? Boolean(emailStatus.tenant.email_identity_id_present) : false;

  const testEmailDisabledReason = !leadToEmail.trim()
    ? "Set Lead To Email first."
    : emailSendMode === "enterprise" && !emailIdentityId.trim()
    ? "Connect Google first (no Email Identity linked yet)."
    : null;

  const canSendTestEmail =
    canEdit &&
    !testingEmail &&
    !!leadToEmail.trim() &&
    (emailSendMode === "standard" || (emailSendMode === "enterprise" && !!emailIdentityId.trim()));

  // Branded Email UI derived bits (client-safe)
  const fromDomain = useMemo(() => prettyDomain(fromEmail), [fromEmail]);

  const brandedTone = useMemo(() => {
    if (!brandedStatus || !brandedStatus.ok) return "neutral" as const;
    if (emailSendMode !== "standard") return "neutral" as const;

    const s = brandedStatus.status;
    if (s === "verified") return "good" as const;
    if (s === "not_verified" || s === "missing_from" || s === "missing_reply_to") return "warn" as const;
    return "neutral" as const;
  }, [brandedStatus, emailSendMode]);

  const brandedRight = useMemo(() => {
    if (emailSendMode !== "standard") return <Pill tone="neutral">Enterprise mode</Pill>;
    if (!brandedStatus) return <Pill tone="neutral">Loading…</Pill>;
    if (!brandedStatus.ok) return <Pill tone="bad">Error</Pill>;

    const label =
      brandedStatus.status === "verified"
        ? "Verified"
        : brandedStatus.status === "not_verified"
        ? "Not verified"
        : brandedStatus.status === "missing_from"
        ? "From missing"
        : brandedStatus.status === "missing_reply_to"
        ? "Reply-To missing"
        : "Unknown";

    if (brandedStatus.usingFallback) {
      return <Pill tone="warn">Fallback active</Pill>;
    }
    return <Pill tone={brandedTone}>{label}</Pill>;
  }, [brandedStatus, brandedTone, emailSendMode]);

  function copyToClipboard(text: string) {
    try {
      navigator.clipboard?.writeText(text);
      setMsg("Copied.");
    } catch {
      // ignore
    }
  }

  // Simple “recommended DNS instructions” placeholder (server will supply real records later)
  const dnsPlaceholder = useMemo(() => {
    const domain = extractDomainFromFromLine(fromEmail) || "yourdomain.com";
    return [
      `1) Add Resend domain: ${domain}`,
      `2) Add SPF/DKIM records in DNS (Resend will provide exact values)`,
      `3) Wait for verification, then retry Test Email`,
    ].join("\n");
  }, [fromEmail]);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 dark:bg-neutral-950">
      <div className="mx-auto w-full max-w-4xl">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Tenant Settings</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Branding and email configuration for the active tenant.
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {activeTenant ? (
                <>
                  <Pill>
                    Tenant: <span className="ml-1 font-mono">{activeTenant.slug}</span>
                  </Pill>
                  {role ? (
                    <Pill>
                      Role: <span className="ml-1 font-mono">{role}</span>
                    </Pill>
                  ) : null}
                </>
              ) : (
                <Pill tone="warn">No active tenant selected</Pill>
              )}

              {emailSendMode === "enterprise" ? (
                <Pill tone={emailIdentityId ? "good" : "warn"}>
                  Enterprise: <span className="ml-1 font-mono">{emailIdentityId ? "connected" : "not connected"}</span>
                </Pill>
              ) : (
                <Pill>Standard mode</Pill>
              )}

              <Pill tone={hasBrandLogo ? "good" : "neutral"}>
                Logo: <span className="ml-1 font-mono">{hasBrandLogo ? "set" : "not set"}</span>
              </Pill>
            </div>

            {msg ? <div className="mt-2 text-sm text-green-700 dark:text-green-300">{msg}</div> : null}
            {err ? <div className="mt-2 text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap">{err}</div> : null}
          </div>
        </div>

        <div className="grid gap-5">
          {/* Active tenant */}
          <Card
            title="Active Tenant"
            subtitle="If you belong to multiple tenants, switch here."
            right={<Pill tone="neutral">{tenants.length} tenants</Pill>}
          >
            {tenants.length === 0 ? (
              <div className="text-sm text-gray-700 dark:text-gray-300">No tenants yet.</div>
            ) : (
              <div className="grid gap-2">
                {tenants.map((t) => {
                  const isActive = t.tenantId === activeTenantId;
                  return (
                    <button
                      key={t.tenantId}
                      onClick={() => switchTenant(t.tenantId)}
                      className={cx(
                        "w-full rounded-xl border p-3 text-left transition",
                        isActive
                          ? "border-blue-300 bg-blue-50 dark:border-blue-900/60 dark:bg-blue-900/15"
                          : "border-gray-200 bg-white hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {t.name || t.slug}{" "}
                          <span className="text-gray-500 dark:text-gray-400 font-normal">({t.slug})</span>
                        </div>
                        <span className="text-xs font-mono text-gray-600 dark:text-gray-300">{t.role}</span>
                      </div>
                      <div className="mt-1 text-xs font-mono text-gray-500 dark:text-gray-400">{t.tenantId}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Branding */}
          <Card
            title="Branding"
            subtitle="Upload a logo or paste a URL. This will be reused on customer-facing pages and emails."
            right={hasBrandLogo ? <Pill tone="good">Logo set</Pill> : <Pill tone="neutral">No logo</Pill>}
          >
            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-white/5">
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">Upload logo</div>
                  <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    PNG/JPG/SVG/WebP up to 2MB. Stored in Vercel Blob.
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={onPickLogoFile}
                      disabled={!canEdit || uploadingLogo}
                      className="hidden"
                    />

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={!canEdit || uploadingLogo}
                      className={cx(
                        "rounded-lg px-3 py-2 text-sm font-semibold transition",
                        "bg-black text-white hover:opacity-90 disabled:opacity-50",
                        "dark:bg-white dark:text-black dark:hover:opacity-90"
                      )}
                    >
                      {uploadingLogo ? "Uploading…" : "Choose file"}
                    </button>

                    {hasBrandLogo ? (
                      <button
                        type="button"
                        onClick={() => setBrandLogoUrl("")}
                        disabled={!canEdit || uploadingLogo}
                        className={cx(
                          "rounded-lg border px-3 py-2 text-sm font-semibold transition",
                          "border-gray-300 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-50",
                          "dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:hover:bg-white/10"
                        )}
                        title="Clears the logo URL (remember to Save)"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>

                  {logoErr ? (
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200">
                      {logoErr}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-neutral-950/40">
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">Logo URL</div>
                  <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    Paste a public https URL (or we’ll set this automatically after upload).
                  </div>

                  <div className="mt-3">
                    <Field
                      label="brand_logo_url"
                      value={brandLogoUrl}
                      onChange={(v) => setBrandLogoUrl(v)}
                      disabled={!canEdit}
                      placeholder="https://..."
                      hint="Tip: leave blank to remove."
                    />
                  </div>
                </div>
              </div>

              {/* Preview */}
              <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-neutral-950/40">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">Preview</div>
                    <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                      This is how the logo will render in the UI (emails may scale it differently).
                    </div>
                  </div>
                  {hasBrandLogo ? (
                    <a
                      href={(brandLogoUrlStr ?? "").trim()}
                      target="_blank"
                      rel="noreferrer"
                      className={cx(
                        "rounded-lg border px-3 py-2 text-sm font-semibold transition",
                        "border-gray-300 bg-white text-gray-800 hover:bg-gray-50",
                        "dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:hover:bg-white/10"
                      )}
                    >
                      Open
                    </a>
                  ) : null}
                </div>

                <div className="mt-3 flex items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 dark:border-white/10 dark:bg-black/30">
                  {hasBrandLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={(brandLogoUrlStr ?? "").trim()}
                      alt="Tenant logo"
                      className="max-h-24 max-w-[280px] object-contain"
                      onError={() => setLogoErr("Logo preview failed to load. Check the URL or upload again.")}
                    />
                  ) : (
                    <div className="text-sm text-gray-500 dark:text-gray-400">No logo set.</div>
                  )}
                </div>
              </div>
            </div>
          </Card>

          {/* Email status */}
          <Card
            title="Email Status"
            subtitle="Shows whether email is configured. Delivery can still be affected by DMARC / spam / quarantine."
            right={
              emailStatus?.ok ? (
                <Pill tone={emailStatus.enabled ? "good" : "warn"}>{emailStatus.enabled ? "Configured" : "Needs setup"}</Pill>
              ) : (
                <Pill tone="neutral">Loading…</Pill>
              )
            }
          >
            {emailStatus?.ok ? (
              <div className="grid gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="neutral">
                    Mode: <span className="ml-1 font-mono">{statusMode}</span>
                  </Pill>
                  <Pill tone={emailStatus.platform.resend_key_present ? "good" : "bad"}>
                    RESEND_API_KEY:{" "}
                    <span className="ml-1 font-mono">{emailStatus.platform.resend_key_present ? "present" : "missing"}</span>
                  </Pill>
                  <Pill tone={enterpriseIdentityPresent ? "good" : "warn"}>
                    email_identity_id: <span className="ml-1 font-mono">{enterpriseIdentityPresent ? "set" : "missing"}</span>
                  </Pill>
                </div>

                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-white/10 dark:bg-white/5">
                  <div className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">Notes</div>
                  <ul className="list-disc space-y-1 pl-5 text-gray-700 dark:text-gray-300">
                    {emailStatus.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : emailStatus ? (
              <div className="text-sm text-red-700 dark:text-red-300">
                {emailStatus.message || emailStatus.error || "Failed to load email status."}
              </div>
            ) : (
              <div className="text-sm text-gray-700 dark:text-gray-300">Loading status…</div>
            )}
          </Card>

          {/* NEW: Branded Email */}
          <Card
            title="Branded Email"
            subtitle="Standard mode can send from your domain once it’s verified. If not verified, we’ll fall back to the platform sender so emails still deliver."
            right={brandedRight}
          >
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="neutral">
                  Selected mode: <span className="ml-1 font-mono">{emailSendMode}</span>
                </Pill>
                <Pill tone={fromEmail.trim() ? "good" : "warn"}>
                  From domain: <span className="ml-1 font-mono">{fromDomain}</span>
                </Pill>
                <Pill tone={leadToEmail.trim() ? "good" : "warn"}>
                  Reply-To: <span className="ml-1 font-mono">{leadToEmail.trim() || "(missing)"}</span>
                </Pill>
              </div>

              {emailSendMode !== "standard" ? (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
                  You’re in <span className="font-mono">enterprise</span> mode. Branded sender verification applies to{" "}
                  <span className="font-mono">standard</span> mode only. Enterprise sends from the connected mailbox for
                  DMARC alignment.
                </div>
              ) : (
                <div className="grid gap-3">
                  <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm dark:border-white/10 dark:bg-neutral-950/40">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-gray-900 dark:text-white">Status</div>
                        <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                          {loadingBranded ? "Checking…" : "Branded sender verification and fallback behavior."}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <SmallButton
                          onClick={() => loadBrandedEmailStatus()}
                          disabled={loadingBranded}
                          tone="neutral"
                        >
                          {loadingBranded ? "Refreshing…" : "Refresh"}
                        </SmallButton>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs dark:border-white/10 dark:bg-white/5">
                        <div className="text-gray-600 dark:text-gray-300">From requested</div>
                        <div className="mt-1 font-mono text-gray-900 dark:text-white">
                          {fromEmail.trim() || "(not set)"}
                        </div>
                      </div>

                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs dark:border-white/10 dark:bg-white/5">
                        <div className="text-gray-600 dark:text-gray-300">From used (after fallback)</div>
                        <div className="mt-1 font-mono text-gray-900 dark:text-white">
                          {brandedStatus?.ok ? brandedStatus.fromUsed || "(unknown until endpoint is wired)" : "(unknown)"}
                        </div>
                      </div>
                    </div>

                    {brandedStatus?.ok ? (
                      <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-white/10 dark:bg-white/5">
                        <div className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">Notes</div>
                        <ul className="list-disc space-y-1 pl-5 text-gray-700 dark:text-gray-300">
                          {(brandedStatus.notes || []).map((n, i) => (
                            <li key={i}>{n}</li>
                          ))}
                        </ul>

                        {brandedStatus.usingFallback ? (
                          <div className="mt-3 text-sm text-yellow-900 dark:text-yellow-100">
                            Fallback is active — emails will send using the platform sender{" "}
                            <span className="font-mono">{brandedStatus.fallbackFrom || "(platform sender)"}</span>, and replies still go to{" "}
                            <span className="font-mono">{leadToEmail.trim() || "(Lead To Email missing)"}</span>.
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-white/10 dark:bg-white/5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-gray-900 dark:text-white">Enable Branded Email</div>
                        <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                          Add and verify your sending domain in Resend. Once verified, we’ll automatically use it as the
                          sender.
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <SmallButton
                          onClick={() => copyToClipboard(dnsPlaceholder)}
                          disabled={!fromEmail.trim()}
                          title={!fromEmail.trim() ? "Set Resend From Email first." : undefined}
                          tone="neutral"
                        >
                          Copy instructions
                        </SmallButton>
                      </div>
                    </div>

                    <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-900 dark:border-white/10 dark:bg-neutral-950/40 dark:text-gray-100">
{dnsPlaceholder}
                    </pre>

                    <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                      Next commit: we’ll show the exact DNS records for your domain and validate verification automatically.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Configuration */}
          <Card title="Configuration" subtitle="Update settings for the active tenant.">
            {loading ? (
              <div className="text-sm text-gray-700 dark:text-gray-300">Loading…</div>
            ) : (
              <div className="grid gap-6">
                {!canEdit ? (
                  <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-900/20 dark:text-yellow-100">
                    You are a <span className="font-mono">{role}</span>. Only <span className="font-mono">owner</span> or{" "}
                    <span className="font-mono">admin</span> can edit tenant settings.
                  </div>
                ) : null}

                {/* Mode selector */}
                <div className="grid gap-3">
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">Email sending mode</div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <label
                      className={cx(
                        "cursor-pointer rounded-2xl border p-4 transition",
                        emailSendMode === "standard"
                          ? "border-blue-300 bg-blue-50 dark:border-blue-900/60 dark:bg-blue-900/15"
                          : "border-gray-200 bg-white hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="radio"
                          name="email_send_mode"
                          checked={emailSendMode === "standard"}
                          onChange={() => {
                            setEmailSendMode("standard");
                            setTestEmailRes(null);
                            // refresh branded UI when mode changes
                            queueMicrotask(() => loadBrandedEmailStatus());
                          }}
                          disabled={!canEdit}
                          className="mt-1"
                        />
                        <div>
                          <div className="text-sm font-semibold text-gray-900 dark:text-white">Standard (Resend)</div>
                          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                            Platform email with domain verification. Recommended for most tenants.
                          </div>
                        </div>
                      </div>
                    </label>

                    <label
                      className={cx(
                        "cursor-pointer rounded-2xl border p-4 transition",
                        emailSendMode === "enterprise"
                          ? "border-blue-300 bg-blue-50 dark:border-blue-900/60 dark:bg-blue-900/15"
                          : "border-gray-200 bg-white hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="radio"
                          name="email_send_mode"
                          checked={emailSendMode === "enterprise"}
                          onChange={() => {
                            setEmailSendMode("enterprise");
                            setTestEmailRes(null);
                            queueMicrotask(() => loadBrandedEmailStatus());
                          }}
                          disabled={!canEdit}
                          className="mt-1"
                        />
                        <div>
                          <div className="text-sm font-semibold text-gray-900 dark:text-white">Enterprise (OAuth)</div>
                          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                            Sends using a connected mailbox (Google / Microsoft). Best for strict IT policies.
                          </div>
                        </div>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Sender & routing */}
                <div className="grid gap-4">
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">Sender &amp; routing</div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <Field
                      label="Business Name"
                      value={businessName}
                      onChange={setBusinessName}
                      disabled={!canEdit}
                      placeholder="Maggio Upholstery"
                    />

                    <Field
                      label="Lead To Email"
                      value={leadToEmail}
                      onChange={setLeadToEmail}
                      disabled={!canEdit}
                      placeholder="leads@yourdomain.com"
                      inputType="email"
                    />
                  </div>

                  <Field
                    label="Resend From Email"
                    value={fromEmail}
                    onChange={(v) => {
                      setFromEmail(v);
                      // lightweight UI refresh only
                      queueMicrotask(() => loadBrandedEmailStatus());
                    }}
                    disabled={!canEdit}
                    placeholder="AI Photo Quote <no-reply@yourdomain.com>"
                    hint="Must be a verified sending domain in Resend. Format: Name <email@domain.com>"
                  />
                </div>

                {/* Enterprise connect */}
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-white/5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">Enterprise connection</div>
                      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                        Connect a mailbox to enable Enterprise sending.
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <a
                        href="/api/admin/email/google/start"
                        className={cx(
                          "rounded-lg border px-3 py-2 text-sm font-semibold transition",
                          "border-gray-300 bg-white text-gray-800 hover:bg-gray-50",
                          "dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:hover:bg-white/10",
                          !canEdit ? "pointer-events-none opacity-50" : ""
                        )}
                      >
                        Connect Google
                      </a>

                      <button
                        type="button"
                        disabled
                        className={cx(
                          "rounded-lg border px-3 py-2 text-sm font-semibold transition",
                          "border-gray-300 bg-white text-gray-700 opacity-60",
                          "dark:border-white/10 dark:bg-white/5 dark:text-gray-300"
                        )}
                        title="Coming soon"
                      >
                        Connect Microsoft (soon)
                      </button>
                    </div>
                  </div>

                  <div className="mt-3">
                    <Field
                      label="Connected Email Identity ID"
                      value={emailIdentityId}
                      onChange={setEmailIdentityId}
                      disabled={!canEdit}
                      placeholder="(auto-populated after OAuth connect)"
                      hint="This is set automatically when OAuth succeeds."
                    />
                  </div>
                </div>

                {/* Test email */}
                <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-neutral-950/40">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">Send Test Email</div>
                      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                        Sends a test message to <span className="font-mono">{leadToEmail || "(set Lead To Email first)"}</span>.
                      </div>
                      {emailSendMode === "enterprise" ? (
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          Enterprise mode selected — sends via your connected mailbox.
                        </div>
                      ) : null}
                    </div>

                    <button
                      onClick={sendTestEmail}
                      disabled={!canSendTestEmail}
                      title={testEmailDisabledReason ?? undefined}
                      className={cx(
                        "rounded-lg px-4 py-2 text-sm font-semibold transition",
                        "bg-black text-white hover:opacity-90 disabled:opacity-50",
                        "dark:bg-white dark:text-black dark:hover:opacity-90"
                      )}
                    >
                      {testingEmail ? "Sending…" : "Send test email"}
                    </button>
                  </div>

                  {testEmailRes ? (
                    <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-900 dark:border-white/10 dark:bg-black/40 dark:text-gray-100">
                      {JSON.stringify(testEmailRes, null, 2)}
                    </pre>
                  ) : null}
                </div>

                {/* Save row */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Tip: upload a logo, configure email routing, then click Save Settings.
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={save}
                      disabled={!canEdit || saving}
                      className={cx(
                        "rounded-lg px-4 py-2 text-sm font-semibold transition",
                        "bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50",
                        "dark:bg-blue-500 dark:hover:bg-blue-400"
                      )}
                    >
                      {saving ? "Saving…" : "Save Settings"}
                    </button>

                    <button
                      type="button"
                      onClick={bootstrap}
                      className={cx(
                        "rounded-lg border px-4 py-2 text-sm font-semibold transition",
                        "border-gray-300 bg-white text-gray-800 hover:bg-gray-50",
                        "dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:hover:bg-white/10"
                      )}
                    >
                      Reload
                    </button>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}