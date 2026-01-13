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
      setMsg("Loaded.");
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
      setMsg("Saved.");
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
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tenant Settings</h1>
          <p className="mt-1 text-sm text-gray-600">
            Email routing + branding for your tenant (auto-detected from login).
          </p>
          {tenant ? (
            <p className="mt-1 text-xs text-gray-500">
              Tenant: <span className="font-mono">{tenant.slug}</span> · ID:{" "}
              <span className="font-mono">{tenant.id}</span>
            </p>
          ) : null}
        </div>

        <div className="flex gap-2">
          <a
            href="/admin/quotes"
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
          >
            Quotes
          </a>
          <button
            onClick={load}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        {loading ? (
          <div className="text-sm text-gray-700">Loading…</div>
        ) : tenant ? (
          <div className="grid gap-4">
            <div>
              <label className="text-sm font-medium text-gray-900">Business Name</label>
              <input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="AI Photo Quote"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-900">Lead To Email (shop inbox)</label>
              <input
                value={leadToEmail}
                onChange={(e) => setLeadToEmail(e.target.value)}
                placeholder="leads@yourdomain.com"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-900">Resend From Email</label>
              <input
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                placeholder='AI Photo Quote <quotes@aiphotoquote.com>'
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">
                Must be a verified sending domain in Resend. Format:{" "}
                <span className="font-mono">Name &lt;email@domain.com&gt;</span>
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={save}
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Settings"}
              </button>

              {msg ? <span className="text-sm text-green-700">{msg}</span> : null}
              {err ? <span className="text-sm text-red-700">{err}</span> : null}
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
              <div className="font-medium">Platform env var still required</div>
              <div className="mt-1">
                <span className="font-mono">RESEND_API_KEY</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-red-700">
            {err || "No tenant found for this user. Check tenant ownership mapping."}
          </div>
        )}
      </div>
    </div>
  );
}
