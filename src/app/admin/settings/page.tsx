"use client";

import React, { useEffect, useMemo, useState } from "react";

type ApiGetResp =
  | {
      ok: true;
      tenantSlug: string;
      tenantId: string;
      settings: {
        business_name: string;
        lead_to_email: string;
        resend_from_email: string;
      };
    }
  | { ok: false; error: string; message?: string; issues?: any };

export default function AdminTenantSettingsPage() {
  const [tenantSlug, setTenantSlug] = useState("");
  const [tenantId, setTenantId] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState("");
  const [leadToEmail, setLeadToEmail] = useState("");
  const [fromEmail, setFromEmail] = useState("");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const canLoad = useMemo(() => tenantSlug.trim().length >= 3, [tenantSlug]);

  useEffect(() => {
    const saved = localStorage.getItem("admin.tenantSlug") || "";
    if (saved) setTenantSlug(saved);
  }, []);

  async function load() {
    setErr(null);
    setMsg(null);
    setLoading(true);

    try {
      localStorage.setItem("admin.tenantSlug", tenantSlug.trim());
      const res = await fetch(`/api/admin/tenant-settings?tenantSlug=${encodeURIComponent(tenantSlug.trim())}`, {
        cache: "no-store",
      });
      const data: ApiGetResp = await res.json();

      if (!data.ok) {
        setTenantId(null);
        setErr(data.message || data.error || "Failed to load tenant settings.");
        return;
      }

      setTenantId(data.tenantId);
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
          tenantSlug: tenantSlug.trim(),
          business_name: businessName.trim(),
          lead_to_email: leadToEmail.trim(),
          resend_from_email: fromEmail.trim(),
        }),
      });

      const data: ApiGetResp = await res.json();

      if (!data.ok) {
        setErr(data.message || data.error || "Failed to save tenant settings.");
        return;
      }

      setTenantId(data.tenantId);
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

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tenant Settings</h1>
          <p className="mt-1 text-sm text-gray-600">
            Configure per-tenant email routing + branding used by quote submit.
          </p>
          {tenantId ? (
            <p className="mt-1 text-xs text-gray-500">
              Tenant ID: <span className="font-mono">{tenantId}</span>
            </p>
          ) : null}
        </div>

        <a
          href="/admin/quotes"
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
        >
          Quotes
        </a>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4">
          <div>
            <label className="text-sm font-medium text-gray-900">Tenant Slug</label>
            <div className="mt-1 flex gap-2">
              <input
                value={tenantSlug}
                onChange={(e) => setTenantSlug(e.target.value)}
                placeholder="maggio-upholstery"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <button
                onClick={load}
                disabled={!canLoad || loading}
                className="rounded-lg bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {loading ? "Loading..." : "Load"}
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              This page uses the slug to find the tenant. (Admin area should already be protected by middleware.)
            </p>
          </div>

          <hr className="border-gray-200" />

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
              Must be a verified sending domain in Resend. Example format: <span className="font-mono">Name &lt;email@domain.com&gt;</span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={!canLoad || saving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Settings"}
            </button>

            {msg ? <span className="text-sm text-green-700">{msg}</span> : null}
            {err ? <span className="text-sm text-red-700">{err}</span> : null}
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
            <div className="font-medium">Heads up</div>
            <ul className="mt-2 list-disc pl-5">
              <li>
                Platform env var still required: <span className="font-mono">RESEND_API_KEY</span>
              </li>
              <li>
                Quote submit reads these values from <span className="font-mono">tenant_settings</span>.
              </li>
              <li>
                Email results are stored on the quote log at <span className="font-mono">quote_logs.output.email</span>.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
