// src/app/pcc/tenants/[tenantId]/delete/page.tsx
import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PreviewResp =
  | {
      ok: true;
      mode?: "archive" | "delete";
      expectedConfirm?: string;
      tenant: { id: string; name: string; slug: string | null; status?: string | null };
      counts: Array<{ key: string; label: string; count: number }> | Record<string, number>;
      notes?: string[];
    }
  | { ok: false; error: string; message?: string; issues?: any };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function normalizeCounts(counts: any): Array<{ key: string; label: string; count: number }> {
  if (!counts) return [];

  if (Array.isArray(counts)) {
    return counts.map((c) => ({
      key: String(c.key),
      label: String(c.label ?? c.key),
      count: Number(c.count ?? 0),
    }));
  }

  const labelMap: Record<string, string> = {
    tenantMembers: "Tenant members",
    tenantSettings: "Tenant settings",
    tenantSecrets: "Tenant secrets",
    tenantPricingRules: "Pricing rules",
    tenantEmailIdentities: "Email identities",
    tenantSubIndustries: "Sub-industries",
    quoteLogs: "Quote logs",
  };

  return Object.entries(counts).map(([key, val]) => ({
    key,
    label: labelMap[key] ?? key,
    count: Number(val ?? 0),
  }));
}

function getBaseUrlFromHeaders(h: Headers) {
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("x-forwarded-host") || h.get("host");
  if (!host) return null;
  return `${proto}://${host}`;
}

async function getPreview(tenantId: string): Promise<PreviewResp> {
  const h = await headers();
  const base = getBaseUrlFromHeaders(h);
  if (!base) return { ok: false, error: "NO_HOST" };

  const cookie = h.get("cookie") || "";

  const res = await fetch(`${base}/api/pcc/tenants/${encodeURIComponent(tenantId)}/delete`, {
    method: "GET",
    cache: "no-store",
    headers: cookie ? { cookie } : undefined,
  }).catch(() => null);

  if (!res) return { ok: false, error: "PREVIEW_FETCH_FAILED" };

  return (await res.json().catch(() => ({ ok: false, error: "BAD_JSON" }))) as PreviewResp;
}

export default async function PccTenantArchivePage({
  params,
}: {
  params: Promise<{ tenantId: string }> | { tenantId: string };
}) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const p = await params;
  const tenantId = String((p as any)?.tenantId ?? "").trim();
  if (!tenantId) redirect("/pcc/tenants");

  const preview = await getPreview(tenantId);
  if (!preview.ok) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Archive tenant</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Could not load archive preview: <span className="font-mono">{preview.error}</span>{" "}
            {preview.message ? `— ${preview.message}` : ""}
          </p>
          <div className="mt-4">
            <Link className="text-sm font-semibold underline" href="/pcc/tenants">
              ← Back to tenants
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const slug = preview.tenant.slug ?? "(unknown)";
  const confirmPhrase = String(preview.expectedConfirm ?? `ARCHIVE ${slug}`);

  const countsList = normalizeCounts((preview as any).counts);

  async function doArchive(formData: FormData) {
    "use server";

    const typed = String(formData.get("confirm") ?? "").trim();
    const tid = String(formData.get("tenantId") ?? "").trim();
    const expected = String(formData.get("expected") ?? "").trim();
    const reason = String(formData.get("reason") ?? "").trim();

    if (!tid) redirect("/pcc/tenants");

    if (!expected || typed !== expected) {
      redirect(`/pcc/tenants/${encodeURIComponent(tid)}/delete?err=confirm`);
    }

    const h = await headers();
    const base = getBaseUrlFromHeaders(h);
    if (!base) {
      redirect(`/pcc/tenants/${encodeURIComponent(tid)}/delete?err=NO_HOST`);
    }

    const cookie = h.get("cookie") || "";

    const res = await fetch(`${base!}/api/pcc/tenants/${encodeURIComponent(tid)}/delete`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({
        confirm: typed,
        expected,
        reason: reason || undefined,
      }),
      cache: "no-store",
    });

    const data = (await res.json().catch(() => null)) as any;
    if (!data?.ok) {
      const msg = encodeURIComponent(String(data?.message ?? data?.error ?? "Archive failed"));
      redirect(`/pcc/tenants/${encodeURIComponent(tid)}/delete?err=${msg}`);
    }

    redirect("/pcc/tenants");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Archive tenant</h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              This will <span className="font-semibold">disable</span> the tenant and preserve all historical data. No records are deleted.
            </p>
          </div>

          <Link className="text-sm font-semibold underline text-gray-600 dark:text-gray-300" href="/pcc/tenants">
            ← Back
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/40 dark:bg-amber-950/30">
        <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">You are archiving:</div>
        <div className="mt-2 text-lg font-semibold text-amber-900 dark:text-amber-100">
          {preview.tenant.name}{" "}
          <span className="ml-2 rounded-full border border-amber-300 bg-white/60 px-2.5 py-1 text-xs font-mono text-amber-900 dark:border-amber-900/60 dark:bg-black/20 dark:text-amber-100">
            {slug}
          </span>
        </div>
        <div className="mt-2 text-xs font-mono text-amber-800/80 dark:text-amber-100/80">{preview.tenant.id}</div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Archive preview</div>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          These records remain stored, but the tenant will be marked archived.
        </p>

        <div className="mt-4 grid gap-2">
          {countsList.map((c) => (
            <div
              key={c.key}
              className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm dark:border-gray-800 dark:bg-black"
            >
              <div className="font-semibold text-gray-900 dark:text-gray-100">{c.label}</div>
              <div className="font-mono text-gray-700 dark:text-gray-200">{c.count}</div>
            </div>
          ))}
        </div>

        {preview.notes?.length ? (
          <div className="mt-4 text-xs text-gray-600 dark:text-gray-300">
            <div className="font-semibold">Notes</div>
            <ul className="mt-1 list-disc pl-5 space-y-1">
              {preview.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Safety confirmation</div>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Type <span className="font-mono">{confirmPhrase}</span> to confirm.
        </p>

        <form action={doArchive} className="mt-4 space-y-3">
          <input type="hidden" name="tenantId" value={preview.tenant.id} />
          <input type="hidden" name="expected" value={confirmPhrase} />

          <input
            name="confirm"
            placeholder={confirmPhrase}
            className={cn(
              "w-full rounded-xl border px-4 py-3 text-sm font-mono",
              "border-gray-200 bg-white text-gray-900 placeholder:text-gray-400",
              "dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:placeholder:text-gray-600"
            )}
          />

          <textarea
            name="reason"
            placeholder="Optional reason (stored in audit log)"
            className={cn(
              "w-full rounded-xl border px-4 py-3 text-sm",
              "border-gray-200 bg-white text-gray-900 placeholder:text-gray-400",
              "dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:placeholder:text-gray-600"
            )}
            rows={3}
          />

          <button type="submit" className="w-full rounded-xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white hover:opacity-90">
            Yes, archive this tenant
          </button>

          <Link
            href={`/pcc/tenants/${encodeURIComponent(preview.tenant.id)}`}
            className="block text-center text-sm font-semibold text-gray-600 underline dark:text-gray-300"
          >
            Cancel
          </Link>
        </form>

        <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Archive is reversible (we’ll add restore + purge later). History stays intact.
        </div>
      </div>
    </div>
  );
}