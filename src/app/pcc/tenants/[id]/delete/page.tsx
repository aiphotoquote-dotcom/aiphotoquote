// src/app/pcc/tenants/[id]/delete/page.tsx
import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PreviewResp =
  | {
      ok: true;
      tenant: { id: string; name: string; slug: string | null };
      counts: Array<{ key: string; label: string; count: number }>;
      notes?: string[];
    }
  | { ok: false; error: string; message?: string };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

async function getPreview(tenantId: string): Promise<PreviewResp> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/pcc/tenants/${encodeURIComponent(tenantId)}/delete`, {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  }).catch(() => null);

  // In server components, fetch() may not include cookies w/ absolute URL.
  // Fall back to relative URL if needed.
  if (!res || !res.ok) {
    const res2 = await fetch(`/api/pcc/tenants/${encodeURIComponent(tenantId)}/delete`, {
      method: "GET",
      cache: "no-store",
    }).catch(() => null);
    if (!res2) return { ok: false, error: "PREVIEW_FETCH_FAILED" };
    return (await res2.json().catch(() => ({ ok: false, error: "BAD_JSON" }))) as PreviewResp;
  }

  return (await res.json().catch(() => ({ ok: false, error: "BAD_JSON" }))) as PreviewResp;
}

export default async function PccTenantDeletePage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const p = await params;
  const tenantId = String((p as any)?.id ?? "").trim();
  if (!tenantId) redirect("/pcc/tenants");

  const preview = await getPreview(tenantId);
  if (!preview.ok) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Delete tenant</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Could not load delete preview: <span className="font-mono">{preview.error}</span>{" "}
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
  const confirmPhrase = `DELETE ${slug}`;

  async function doDelete(formData: FormData) {
    "use server";

    const typed = String(formData.get("confirm") ?? "").trim();
    const tid = String(formData.get("tenantId") ?? "").trim();

    if (!tid) redirect("/pcc/tenants");

    // Server-side safety: require exact phrase
    if (typed !== confirmPhrase) {
      redirect(`/pcc/tenants/${encodeURIComponent(tid)}/delete?err=confirm`);
    }

    const res = await fetch(`/api/pcc/tenants/${encodeURIComponent(tid)}/delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: typed }),
      cache: "no-store",
    });

    const data = (await res.json().catch(() => null)) as any;
    if (!data?.ok) {
      const msg = encodeURIComponent(String(data?.message ?? data?.error ?? "Delete failed"));
      redirect(`/pcc/tenants/${encodeURIComponent(tid)}/delete?err=${msg}`);
    }

    redirect("/pcc/tenants");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Delete tenant</h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              This will delete the tenant and all associated data. This cannot be undone.
            </p>
          </div>

          <Link className="text-sm font-semibold underline text-gray-600 dark:text-gray-300" href="/pcc/tenants">
            ← Back
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 dark:border-red-900/40 dark:bg-red-950/30">
        <div className="text-sm font-semibold text-red-900 dark:text-red-100">You are deleting:</div>
        <div className="mt-2 text-lg font-semibold text-red-900 dark:text-red-100">
          {preview.tenant.name}{" "}
          <span className="ml-2 rounded-full border border-red-300 bg-white/60 px-2.5 py-1 text-xs font-mono text-red-900 dark:border-red-900/60 dark:bg-black/20 dark:text-red-100">
            {slug}
          </span>
        </div>
        <div className="mt-2 text-xs font-mono text-red-800/80 dark:text-red-100/80">{preview.tenant.id}</div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Deletion preview</div>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Counts that will be removed.</p>

        <div className="mt-4 grid gap-2">
          {preview.counts.map((c) => (
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

        <form action={doDelete} className="mt-4 space-y-3">
          <input type="hidden" name="tenantId" value={preview.tenant.id} />
          <input
            name="confirm"
            placeholder={confirmPhrase}
            className={cn(
              "w-full rounded-xl border px-4 py-3 text-sm font-mono",
              "border-gray-200 bg-white text-gray-900 placeholder:text-gray-400",
              "dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:placeholder:text-gray-600"
            )}
          />

          <button
            type="submit"
            className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:opacity-90"
          >
            Yes, delete this tenant and all data
          </button>

          <Link
            href={`/pcc/tenants/${encodeURIComponent(preview.tenant.id)}`}
            className="block text-center text-sm font-semibold text-gray-600 underline dark:text-gray-300"
          >
            Cancel
          </Link>
        </form>
      </div>
    </div>
  );
}