"use client";

import React, { useEffect, useState } from "react";

type Resp =
  | {
      ok: true;
      tenant: { id: string; slug: string };
      settings: { business_name: string; lead_to_email: string; resend_from_email: string };
    }
  | { ok: false; error: string; message?: string; issues?: any };

export default function AdminTenantSettingsPage() {
  const [tenant, setTenant] = useState<{ id: string; slug: string } | null>(null);

  const [businessName, setBusinessName] = useState("");
  const [leadToEmail, setLeadToEmail] = useState("");
  const [fromEmail, setFromEmail] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    setMsg(null);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/tenant-settings", { cache: "no-store" });
      const data: Resp = await res.json();

      if (!data.ok) {
        setTenant(null);
        setErr(data.message || data.error || "Failed to load tenant settings.");
        return;
      }

      setTenant(data.tenant);
      setBusinessName(data.settings.business_name || "");
      setLeadToEmail(data.settings.lead_to_email || "");
      setFromEmail(data.settings.resend_from_email || "");
      setMsg("Settings loaded.");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setErr(null);
    setMsg(null);
    setSaving(true);

    try {
      const res = await fetch("/api/admin/tenant-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_name: businessName.trim(),
          lead_to_email: leadToEmail.trim(),
          resend_from_email: fromEmail.trim(),
        }),
      });

      const data: Resp = await res.json();

      if (!data.ok) {
        setErr(data.message || data.error || "Failed to save tenant settings.");
        return;
      }

      setTenant(data.tenant);
      setBusinessName(data.settings.business_name || "");
      setLeadToEmail(data.settings.lead_to_email || "");
      setFromEmail(data.settings.resend_from_email || "");
      setMsg("Settings saved.");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-3xl p-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Tenant Settings</h1>
          <p className="mt-1 text-sm text-gray-600">
            Email routing and branding for your account.
          </p>
          {tenant ? (
            <p className="mt-1 text-xs text-gray-500">
              Tenant: <span className="font-mono">{tenant.slug}</span>
            </p>
          ) : null}
        </div>

        <a
          href="/admin/quotes"
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
        >
          ← Quotes
        </a>
      </div>

      {/* Card */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        {loading ? (
          <div className="text-sm text-gray-700">Loading…</div>
        ) : tenant ? (
          <div className="grid gap-5">
            {/* Business name */}
            <div>
              <label className="block text-sm font-medium text-gray-800">
                Business Name
              </label>
              <input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="AI Photo Quote"
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Lead email */}
            <div>
              <label className="block text-sm font-medium text-gray-800">
                Lead To Email
              </label>
              <input
                value={leadToEmail}
                onChange={(e) => setLeadToEmail(e.target.value)}
                placeholder="leads@yourdomain.com"
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Where new quote requests are delivered.
              </p>
            </div>

            {/* From email */}
            <div>
              <label className="block text-sm font-medium text-gray-800">
                Resend From Email
              </label>
              <input
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                placeholder='AI Photo Quote <quotes@aiphotoquote.com>'
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Must be a verified sending domain in Resend.
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-4">
              <button
                onClick={save}
                disabled={saving}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save Settings"}
              </button>

              {msg && <span className="text-sm text-green-700">{msg}</span>}
              {err && <span className="text-sm text-red-700">{err}</span>}
            </div>

            {/* Info */}
            <div className="rounded-lg border border-gray-200 bg-gray-100 p-4 text-sm text-gray-700">
              <div className="font-medium text-gray-800 mb-1">Note</div>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  Platform environment variable still required:{" "}
                  <span className="font-mono">RESEND_API_KEY</span>
                </li>
                <li>
                  These settings are used automatically by the quote submission flow.
                </li>
                <li>
                  Email results are logged per quote for admin visibility.
                </li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="text-sm text-red-700">
            {err || "No tenant found for this account."}
          </div>
        )}
      </div>
    </div>
  );
}
