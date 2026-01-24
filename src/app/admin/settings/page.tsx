// src/app/admin/settings/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

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
        email_send_mode?: string | null;
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

        // NEW (enterprise readiness)
        email_send_mode?: "standard" | "enterprise";
        email_identity_id_present?: boolean;
      };
      notes: string[];
    }
  | { ok: false; error: string; message?: string };

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

export default function AdminTenantSettingsPage() {
  const [context, setContext] = useState<{ activeTenantId: string | null; tenants: TenantRow[] }>({
    activeTenantId: null,
    tenants: [],
  });

  const [role, setRole] = useState<"owner" | "admin" | "member" | null>(null);

  const [businessName, setBusinessName] = useState("");
  const [leadToEmail, setLeadToEmail] = useState("");
  const [fromEmail, setFromEmail] = useState("");

  // NEW: email send mode + identity (Enterprise OAuth placeholder)
  const [emailSendMode, setEmailSendMode] = useState<"standard" | "enterprise">("standard");
  const [emailIdentityId, setEmailIdentityId] = useState<string>("");

  const [emailStatus, setEmailStatus] = useState<EmailStatusResp | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const canEdit = useMemo(() => role === "owner" || role === "admin", [role]);

  const CONTEXT_URL = "/api/tenant/context";
  const SETTINGS_URL = "/api/admin/tenant-settings";
  const EMAIL_STATUS_URL = "/api/admin/email/status";

  // ✅ HARDEN: tenants is always an array, even if something goes sideways
  const tenants = useMemo(() => (Array.isArray(context?.tenants) ? context.tenants : []), [context]);
  const activeTenantId = context?.activeTenantId ?? null;

  // ✅ HARDEN: never call .find on undefined
  const activeTenant = useMemo(() => {
    if (!activeTenantId) return null;
    return tenants.find((t) => t.tenantId === activeTenantId) || null;
  }, [tenants, activeTenantId]);

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

    const modeRaw = (data.settings.email_send_mode ?? "").toString().trim().toLowerCase();
    const mode = modeRaw === "enterprise" ? "enterprise" : "standard";
    setEmailSendMode(mode);

    setEmailIdentityId((data.settings.email_identity_id ?? "").toString());
  }

  async function loadEmailStatus() {
    const res = await fetch(EMAIL_STATUS_URL, { cache: "no-store" });
    const data = await safeJson<EmailStatusResp>(res);
    setEmailStatus(data);
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
        setMsg(null);
        setErr("No tenants found for this user yet.");
        return;
      }

      await loadSettings();
      await loadEmailStatus();

      setMsg("Loaded.");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setEmailStatus(null);
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

  async function save() {
    setErr(null);
    setMsg(null);
    setSaving(true);

    try {
      const res = await fetch(SETTINGS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_name: businessName.trim(),
          lead_to_email: leadToEmail.trim(),
          resend_from_email: fromEmail.trim(),

          // NEW
          email_send_mode: emailSendMode,
          email_identity_id: emailIdentityId.trim() || null,
        }),
      });

      const data = await safeJson<SettingsResp>(res);
      if (!data.ok) throw new Error(data.message || data.error || "Failed to save settings");

      setRole(data.role);

      // Refresh email readiness immediately after save
      await loadEmailStatus();

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

    const testEmailDisabledReason =
    !leadToEmail.trim()
      ? "Set Lead To Email first."
      : emailSendMode === "enterprise" && !emailIdentityId.trim()
        ? "Connect Google first (no Email Identity linked yet)."
        : null;

   const canSendTestEmail =
    canEdit &&
    !testingEmail &&
    !!leadToEmail.trim() &&
    (emailSendMode === "standard" || (emailSendMode === "enterprise" && !!emailIdentityId.trim()));

  return (
    <div className="mx-auto max-w-3xl p-6 bg-gray-50 min-h-screen">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Tenant Settings</h1>
          <p className="mt-1 text-sm text-gray-600">Email routing and branding for the active tenant.</p>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {activeTenant ? (
              <>
                <span className="rounded-md bg-white border border-gray-200 px-2 py-1 text-gray-800">
                  Tenant: <span className="font-mono">{activeTenant.slug}</span>
                </span>
                {role ? (
                  <span className="rounded-md bg-white border border-gray-200 px-2 py-1 text-gray-800">
                    Role: <span className="font-mono">{role}</span>
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-gray-600">No active tenant selected.</span>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <a
            href="/admin/quotes"
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
          >
            ← Quotes
          </a>
          <button
            onClick={bootstrap}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Tenant switcher */}
      <div className="mb-5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-gray-900">Active Tenant</div>
        <p className="mt-1 text-sm text-gray-600">If you belong to multiple tenants, switch here.</p>

        <div className="mt-3 flex flex-col gap-2">
          {tenants.length === 0 ? (
            <div className="text-sm text-gray-700">No tenants yet.</div>
          ) : (
            tenants.map((t) => (
              <button
                key={t.tenantId}
                onClick={() => switchTenant(t.tenantId)}
                className={[
                  "w-full text-left rounded-md border px-3 py-2 text-sm hover:bg-gray-50",
                  t.tenantId === activeTenantId ? "border-blue-400 bg-blue-50" : "border-gray-200 bg-white",
                ].join(" ")}
              >
                <div className="flex items-center justify-between">
                  <div className="text-gray-900 font-medium">
                    {t.name || t.slug} <span className="text-gray-500 font-normal">({t.slug})</span>
                  </div>
                  <div className="text-xs text-gray-600 font-mono">{t.role}</div>
                </div>
                <div className="mt-1 text-xs text-gray-500 font-mono">{t.tenantId}</div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Live email readiness */}
      <div className="mb-5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-gray-900">Email Status</div>
        <p className="mt-1 text-sm text-gray-600">
          This shows whether email is configured (domain verification / token validity may still be required).
        </p>

        {emailStatus?.ok ? (
          <div className="mt-3 grid gap-2 text-sm">
            <div
              className={[
                "rounded-lg border p-3",
                emailStatus.enabled ? "border-green-200 bg-green-50" : "border-yellow-200 bg-yellow-50",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-gray-900">
                  {emailStatus.enabled ? "Configured" : "Needs setup"}
                </div>

                <span className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-800">
                  Mode: <span className="font-mono">{statusMode}</span>
                </span>
              </div>

              <ul className="mt-1 list-disc pl-5 text-gray-700 space-y-1">
                {emailStatus.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>

            <div className="grid gap-1 text-xs text-gray-700">
              <div>
                Platform: RESEND_API_KEY{" "}
                <span className={emailStatus.platform.resend_key_present ? "text-green-700" : "text-red-700"}>
                  {emailStatus.platform.resend_key_present ? "present" : "missing"}
                </span>
              </div>

              <div>
                Tenant: business_name{" "}
                <span className={emailStatus.tenant.business_name_present ? "text-green-700" : "text-red-700"}>
                  {emailStatus.tenant.business_name_present ? "set" : "missing"}
                </span>
                {" · "}lead_to_email{" "}
                <span className={emailStatus.tenant.lead_to_email_present ? "text-green-700" : "text-red-700"}>
                  {emailStatus.tenant.lead_to_email_present ? "set" : "missing"}
                </span>
                {" · "}resend_from_email{" "}
                <span className={emailStatus.tenant.resend_from_email_present ? "text-green-700" : "text-red-700"}>
                  {emailStatus.tenant.resend_from_email_present ? "set" : "missing"}
                </span>
                {" · "}email_identity_id{" "}
                <span className={enterpriseIdentityPresent ? "text-green-700" : "text-red-700"}>
                  {enterpriseIdentityPresent ? "set" : "missing"}
                </span>
              </div>
            </div>
          </div>
        ) : emailStatus ? (
          <div className="mt-3 text-sm text-red-700">
            {emailStatus.message || emailStatus.error || "Failed to load email status."}
          </div>
        ) : (
          <div className="mt-3 text-sm text-gray-700">Loading status…</div>
        )}
      </div>

      {/* Settings */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        {loading ? (
          <div className="text-sm text-gray-700">Loading…</div>
        ) : (
          <div className="grid gap-5">
            {!canEdit ? (
              <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900">
                You are a <span className="font-mono">{role}</span>. Only <span className="font-mono">owner</span> or{" "}
                <span className="font-mono">admin</span> can edit tenant settings.
              </div>
            ) : null}

            {/* Standard mode */}
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Standard (Recommended)</div>
                  <p className="mt-1 text-sm text-gray-600">
                    Platform email with tenant domain verification. “From” looks like your business.
                  </p>
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="email_send_mode"
                    checked={emailSendMode === "standard"}
                    onChange={() => {
                      setEmailSendMode("standard");
                      // optional UX: clear prior test result/errors when switching modes
                      setTestEmailRes(null);
                    }}
                    disabled={!canEdit}
                  />
                  <span className="text-gray-800">Use Standard</span>
                </label>
              </div>

              <div className="mt-4 grid gap-5">
                <div>
                  <label className="block text-sm font-medium text-gray-800">Business Name</label>
                  <input
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    disabled={!canEdit}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-800">Lead To Email</label>
                  <input
                    value={leadToEmail}
                    onChange={(e) => setLeadToEmail(e.target.value)}
                    disabled={!canEdit}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-800">Resend From Email</label>
                  <input
                    value={fromEmail}
                    onChange={(e) => setFromEmail(e.target.value)}
                    disabled={!canEdit}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Must be a verified sending domain in Resend. Format:{" "}
                    <span className="font-mono">Name &lt;email@domain.com&gt;</span>
                  </p>
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="text-sm font-semibold text-gray-900">Send Test Email</div>
                  <p className="mt-1 text-sm text-gray-600">
                    Sends a test message to{" "}
                    <span className="font-mono">{leadToEmail || "(set Lead To Email first)"}</span>.
                  </p>

                  <div className="mt-3 flex items-center gap-3">
                    <button
                      onClick={sendTestEmail}
                      disabled={!canSendTestEmail}
                      className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                      title={testEmailDisabledReason ?? undefined}
                    >
                      {testingEmail ? "Sending…" : "Send test email"}
                    </button>

                                      {emailSendMode === "enterprise" ? (
                      <span className="text-xs text-gray-600">
                        Enterprise mode selected — this will send via your connected mailbox.
                      </span>
                    ) : null}

                  </div>

                  {testEmailRes ? (
                    <pre className="mt-3 overflow-auto rounded-md bg-white border border-gray-200 p-3 text-xs">
                      {JSON.stringify(testEmailRes, null, 2)}
                    </pre>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Enterprise mode (OAuth) */}
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Enterprise (OAuth)</div>
                  <p className="mt-1 text-sm text-gray-600">
                    Send email using a mailbox-native provider (Google / Microsoft) with OAuth “send as”.
                    Best for strict IT policies.
                  </p>
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="email_send_mode"
                    checked={emailSendMode === "enterprise"}
                    onChange={() => {
                      setEmailSendMode("enterprise");
                      // optional UX: clear prior test result/errors when switching modes
                      setTestEmailRes(null);
                    }}
                    disabled={!canEdit}
                  />
                  <span className="text-gray-800">Use Enterprise</span>
                </label>
              </div>

              <div className="mt-4 grid gap-3">
                <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900">
                  Enterprise OAuth is not wired up yet. This section is here so we can store the mode + identity id
                  now, and implement Google/Microsoft linking next.
                </div>

                <div className="grid gap-2">
                  <label className="block text-sm font-medium text-gray-800">Connected Email Identity ID</label>
                  <input
                    value={emailIdentityId}
                    onChange={(e) => setEmailIdentityId(e.target.value)}
                    disabled={!canEdit}
                    placeholder="(auto-populated after OAuth connect)"
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                  />
                  <p className="text-xs text-gray-500">
                    This will reference a future <span className="font-mono">email_identities</span> table row
                    (encrypted refresh token + provider metadata).
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
<a
  href="/api/admin/email/google/start"
  className={[
    "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50",
    !canEdit ? "pointer-events-none opacity-50" : "",
  ].join(" ")}
>
  Connect Google
</a>

                  <button
                    type="button"
                    disabled
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
                    title="Coming soon"
                  >
                    Connect Microsoft (coming soon)
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={save}
                disabled={!canEdit || saving}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save Settings"}
              </button>

              {msg && <span className="text-sm text-green-700">{msg}</span>}
              {err && <span className="text-sm text-red-700 whitespace-pre-wrap">{err}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}