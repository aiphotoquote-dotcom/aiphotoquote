import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs, tenants } from "@/lib/db/schema";

function getCookieTenantId(jar: Awaited<ReturnType<typeof cookies>>) {
  const candidates = [
    jar.get("activeTenantId")?.value,
    jar.get("active_tenant_id")?.value,
    jar.get("tenantId")?.value,
    jar.get("tenant_id")?.value,
  ].filter(Boolean) as string[];

  return candidates[0] || null;
}

async function resolveTenantId(userId: string) {
  const jar = await cookies();
  let tenantId = getCookieTenantId(jar);

  // Fallback: if cookie isn't set, use the tenant owned by this user
  if (!tenantId) {
    const t = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.ownerClerkUserId, userId))
      .limit(1)
      .then((r) => r[0] ?? null);

    tenantId = t?.id ?? null;
  }

  return tenantId;
}

export default async function AdminQuotesPage() {
  const { userId } = await auth();
  if (!userId) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            You must be signed in.
          </p>
          <div className="mt-6">
            <Link className="underline" href="/sign-in">
              Sign in
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const tenantId = await resolveTenantId(userId);

  if (!tenantId) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <h1 className="text-2xl font-semibold">Quotes</h1>

          <div className="mt-6 rounded-2xl border border-yellow-200 bg-yellow-50 p-5 text-sm text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
            No active tenant selected. Go to{" "}
            <Link className="underline" href="/onboarding">
              Settings
            </Link>{" "}
            and make sure your tenant is created/selected.
          </div>

          <div className="mt-6">
            <Link className="underline" href="/dashboard">
              Back to dashboard
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const rows = await db
    .select({
      id: quoteLogs.id,
      createdAt: quoteLogs.createdAt,
      input: quoteLogs.input,
      renderStatus: quoteLogs.renderStatus,
      renderOptIn: quoteLogs.renderOptIn,
    })
    .from(quoteLogs)
    .where(eq(quoteLogs.tenantId, tenantId))
    .orderBy(desc(quoteLogs.createdAt))
    .limit(50);

  function pickString(v: any) {
    return typeof v === "string" ? v : "";
  }

  function pickPhone(input: any) {
    // your quote input schemas have varied over time—support several common shapes
    const cc = input?.customer_context ?? input?.customer ?? input?.lead ?? input ?? null;

    return (
      pickString(cc?.phone) ||
      pickString(cc?.phoneNumber) ||
      pickString(cc?.tel) ||
      pickString(cc?.mobile) ||
      ""
    );
  }

  function pickName(input: any) {
    const cc = input?.customer_context ?? input?.customer ?? input?.lead ?? input ?? null;

    const full =
      pickString(cc?.name) ||
      pickString(cc?.fullName) ||
      pickString(cc?.customerName) ||
      "";

    const first = pickString(cc?.firstName);
    const last = pickString(cc?.lastName);

    if (full) return full.trim();
    const joined = `${first} ${last}`.trim();
    return joined || "New customer";
  }

  function formatWhen(d: Date | null) {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      return String(d);
    }
  }

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Quotes</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Latest quotes for your tenant.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Dashboard
            </Link>
            <Link
              href="/onboarding"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Settings
            </Link>
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
          <div className="grid grid-cols-12 bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600 dark:bg-gray-900 dark:text-gray-300">
            <div className="col-span-3">Created</div>
            <div className="col-span-5">Customer</div>
            <div className="col-span-2">Render</div>
            <div className="col-span-2 text-right">Action</div>
          </div>

          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {rows.length ? (
              rows.map((q) => {
                const input: any = q.input ?? {};
                const name = pickName(input);
                const phone = pickPhone(input);

                const status = String(q.renderStatus ?? "").toLowerCase();
                const renderLabel =
                  status === "rendered"
                    ? "Rendered"
                    : status === "failed"
                      ? "Failed"
                      : status === "queued" || status === "running"
                        ? "Rendering"
                        : q.renderOptIn
                          ? "Opt-in"
                          : "Estimate";

                return (
                  <li key={q.id} className="grid grid-cols-12 items-center gap-2 px-4 py-3">
                    <div className="col-span-3 text-sm text-gray-800 dark:text-gray-200">
                      {formatWhen(q.createdAt as any)}
                    </div>

                    <div className="col-span-5">
                      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {name}
                      </div>
                      <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                        {phone ? phone : "No phone provided"}
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-gray-500 dark:text-gray-400">
                        {q.id}
                      </div>
                    </div>

                    <div className="col-span-2">
                      <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-200">
                        {renderLabel}
                      </span>
                    </div>

                    <div className="col-span-2 flex justify-end">
                      <Link
                        href={`/admin/quotes/${q.id}`}
                        className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                      >
                        Open
                      </Link>
                    </div>
                  </li>
                );
              })
            ) : (
              <li className="px-4 py-6 text-sm text-gray-600 dark:text-gray-300">
                No quotes yet.
              </li>
            )}
          </ul>
        </div>
      </div>
    </main>
  );
}
