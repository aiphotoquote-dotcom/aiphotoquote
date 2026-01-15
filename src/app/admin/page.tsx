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

type SetupResp =
  | {
      ok: true;
      tenantId: string;
      role: "owner" | "admin" | "member";
      progress: { completedCount: number; totalCount: number; pct: number };
      steps: Array<{ key: string; title: string; complete: boolean; description: string; href: string }>;
      nextStep: { key: string; title: string; complete: boolean; description: string; href: string } | null;
      latestQuoteLogId: string | null;
    }
  | { ok: false; error: string; message?: string };

async function safeJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Expected JSON but got "${ct || "unknown"}" (status ${res.status}). First 80 chars: ${text.slice(0, 80)}`
    );
  }
  return (await res.json()) as T;
}

export default function AdminHome() {
  const [context, setContext] = useState<{ activeTenantId: string | null; tenants: TenantRow[] }>({
    activeTenantId: null,
    tenants: [],
  });

  const [setup, setSetup] = useState<SetupResp | null>(null);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const activeTenant = useMemo(
    () => context.tenants.find((t) => t.tenantId === context.activeTenantId) || null,
    [context]
  );

  const CONTEXT_URL = "/api/tenant/context"; // sets cookie automatically on GET
  const SETUP_URL = "/api/admin/setup/status";

  async function loadAll() {
    setErr(null);
    setLoading(true);

    try {
      // 1) Ensure active tenant cookie is set
      const cRes = await fetch(CONTEXT_URL, { cache: "no-store" });
      const cData = await safeJson<ContextResp>(cRes);
      if (!cData.ok) throw new Error(cData.message || cData.error || "Failed to load tenant context");

      setContext({ activeTenantId: cData.activeTenantId, tenants: cData.tenants });

      if (!cData.activeTenantId) {
        setSetup(null);
        setErr("No tenant found yet. Create a tenant first (or verify membership).");
        return;
      }

      // 2) Load setup checklist status
      const sRes = await fetch(SETUP_URL, { cache: "no-store" });
      const sData = await safeJson<SetupResp>(sRes);
      setSetup(sData);

      if (!("ok" in sData) || (sData as any).ok === false) {
        const bad = sData as any;
        throw new Error(bad.message || bad.error || "Failed to load setup status");
      }
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setSetup(null);
    } finally {
      setLoading(false);
    }
  }

  async function switchTenant(tenantId: string) {
    setErr(null);
    setLoading(true);

    try {
      const res = await fetch(CONTEXT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });
      const data = await safeJson<any>(res);
      if (!data?.ok) throw new Error(data?.message || data?.error || "Failed to switch tenant");
      await loadAll();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setupOk = (setup as any)?.ok === true;
  const progress = setupOk ? (setup as any).progress : null;
  const steps = setupOk ? (setup as any).steps : [];
  const nextStep = setupOk ? (setup as any).nextStep : null;

  return (
    <div className="mx-auto max-w-4xl p-6 bg-gray-50 min-h-screen">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Tenant Admin</h1>
          <p className="mt-1 text-sm text-gray-600">
            Setup checklist + quick access to the tools your tenant needs to go live.
          </p>
          {activeTenant ? (
            <div className="mt-2 flex flex-wrap gap-2 text-sm">
              <span className="rounded-md bg-white border border-gray-200 px-2 py-1 text-gray-800">
                Tenant: <span className="font-mono">{activeTenant.slug}</span>
              </span>
              <span className="rounded-md bg-white border border-gray-200 px-2 py-1 text-gray-800">
                Role: <span className="font-mono">{activeTenant.role}</span>
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex gap-2">
          <a
            href="/admin/settings"
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
          >
            Settings
          </a>
          <a
            href="/admin/quotes"
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
          >
            Quotes
          </a>
          <button
            onClick={loadAll}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Tenant switcher */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-gray-900">Active Tenant</div>
        <p className="mt-1 text-sm text-gray-600">Switch tenants if you belong to more than one.</p>

        <div className="mt-3 grid gap-2">
          {context.tenants.length === 0 ? (
            <div className="text-sm text-gray-700">No tenants found.</div>
          ) : (
            context.tenants.map((t) => (
              <button
                key={t.tenantId}
                onClick={() => switchTenant(t.tenantId)}
                className={[
                  "w-full text-left rounded-md border px-3 py-2 text-sm hover:bg-gray-50",
                  t.tenantId === context.activeTenantId ? "border-blue-400 bg-blue-50" : "border-gray-200 bg-white",
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

      {/* Setup status */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        {loading ? (
          <div className="text-sm text-gray-700">Loading…</div>
        ) : err ? (
          <div className="text-sm text-red-700 whitespace-pre-wrap">{err}</div>
        ) : setupOk ? (
          <div className="grid gap-6">
            {/* Progress */}
            <div>
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-900">Setup Progress</div>
                <div className="text-sm text-gray-700">
                  {progress.completedCount}/{progress.totalCount} complete ({progress.pct}%)
                </div>
              </div>

              <div className="mt-2 h-3 w-full rounded-full bg-gray-200 overflow-hidden">
                <div className="h-3 bg-blue-600" style={{ width: `${progress.pct}%` }} />
              </div>

              {nextStep ? (
                <div className="mt-3 flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 p-4">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">Next step</div>
                    <div className="text-sm text-gray-700">{nextStep.title}</div>
                    <div className="mt-1 text-xs text-gray-600">{nextStep.description}</div>
                  </div>
                  <a
                    href={nextStep.href}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    Continue →
                  </a>
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
                  🎉 Setup complete. You’re ready to go live.
                </div>
              )}
            </div>

            {/* Checklist */}
            <div>
              <div className="text-sm font-semibold text-gray-900">Checklist</div>
              <div className="mt-3 grid gap-2">
                {steps.map((s: any) => (
                  <a
                    key={s.key}
                    href={s.href}
                    className="rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50"
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-gray-900">{s.title}</div>
                      <div
                        className={[
                          "text-xs font-semibold px-2 py-1 rounded-md border",
                          s.complete
                            ? "border-green-200 bg-green-50 text-green-800"
                            : "border-gray-200 bg-gray-100 text-gray-700",
                        ].join(" ")}
                      >
                        {s.complete ? "Complete" : "Not done"}
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-gray-600">{s.description}</div>
                  </a>
                ))}
              </div>
            </div>

            {/* Quick links */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="text-sm font-semibold text-gray-900">Quick links</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <a className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-100" href="/q/maggio-upholstery">
                  Public quote page (example)
                </a>
                <a className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-100" href="/quote">
                  Internal test quote form
                </a>
              </div>
              <div className="mt-2 text-xs text-gray-600">
                Tip: once the widget page exists, we’ll replace the example link with the tenant’s real embed + live URLs.
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-700">No setup status available.</div>
        )}
      </div>
    </div>
  );
}
