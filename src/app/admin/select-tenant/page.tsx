// src/app/admin/select-tenant/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type TenantRow = { tenantId: string; slug: string; name: string | null; role: "owner" | "admin" | "member" };

type ContextResp =
  | {
      ok: true;
      activeTenantId: string | null;
      tenants: TenantRow[];
      needsTenantSelection?: boolean;
      autoSelected?: boolean;
    }
  | { ok: false; error: string; message?: string };

async function safeJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(`Expected JSON but got "${ct || "unknown"}" (status ${res.status}). First 80 chars: ${text.slice(0, 80)}`);
  }
  return (await res.json()) as T;
}

export default function SelectTenantPage() {
  const router = useRouter();
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch("/api/tenant/context", { cache: "no-store" });
      const data = await safeJson<ContextResp>(res);
      if (!data.ok) throw new Error(data.message || data.error || "Failed to load tenant context");

      setTenants(data.tenants || []);
      setActiveTenantId(data.activeTenantId ?? null);

      // If it got auto-selected (single tenant), go straight to admin
      if (data.activeTenantId && data.autoSelected) {
        router.replace("/admin");
      }
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function choose(tenantId: string) {
    setErr(null);
    setBusyId(tenantId);
    try {
      const res = await fetch("/api/tenant/context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });
      const data = await safeJson<any>(res);
      if (!data?.ok) throw new Error(data?.message || data?.error || "Failed to set active tenant");
      router.replace("/admin");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setBusyId(null);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Select Tenant</h1>
      <p className="mt-2 text-sm text-gray-600">
        You need an active tenant before accessing the admin area.
      </p>

      {err ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {err}
        </div>
      ) : null}

      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-4">
        {loading ? (
          <div className="text-sm text-gray-700">Loading…</div>
        ) : tenants.length === 0 ? (
          <div className="text-sm text-gray-700">
            No tenants found for this account yet.
          </div>
        ) : (
          <div className="space-y-2">
            {tenants.map((t) => {
              const isActive = t.tenantId === activeTenantId;
              const isBusy = busyId === t.tenantId;
              return (
                <button
                  key={t.tenantId}
                  onClick={() => choose(t.tenantId)}
                  disabled={isBusy}
                  className={[
                    "w-full rounded-xl border px-4 py-3 text-left transition",
                    isActive ? "border-blue-300 bg-blue-50" : "border-gray-200 bg-white hover:bg-gray-50",
                    isBusy ? "opacity-60" : "",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-gray-900">
                        {t.name || t.slug} <span className="font-normal text-gray-500">({t.slug})</span>
                      </div>
                      <div className="mt-0.5 text-xs font-mono text-gray-500 truncate">{t.tenantId}</div>
                    </div>
                    <div className="shrink-0 text-xs font-mono text-gray-600">
                      {isBusy ? "…" : t.role}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-4">
        <button
          onClick={load}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}