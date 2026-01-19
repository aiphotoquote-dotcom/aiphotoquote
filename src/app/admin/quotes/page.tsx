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

  // 1) Try cookie
  const jar = await cookies();
  let tenantId = getCookieTenantId(jar);

  // 2) Fallback: resolve tenant by ownerClerkUserId
  // NOTE: This assumes 1 tenant per user for now.
  if (!tenantId) {
    const t = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.ownerClerkUserId, userId))
      .limit(1)
      .then((r) => r[0] ?? null);

    tenantId = t?.id ?? null;
  }

  if (!tenantId) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <h1 className="text-2xl font-semibold">Quotes</h1>

          <div className="mt-6 rounded-2xl border border-yellow-200 bg-yellow-50 p-5 text-sm text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
            No tenant found for your user. Go to{" "}
            <Link className="underline" href="/onboarding">
              Settings
            </Link>{" "}
            and complete setup.
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
      renderStatus: quoteLogs.renderStatus,
      renderOptIn: quoteLogs.renderOptIn,
    })
    .from(quoteLogs)
    .where(eq(quoteLogs.tenantId, tenantId))
    .orderBy(desc(quoteLogs.createdAt))
    .limit(50);

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Quotes</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Latest quotes for your tenant.
            </p>
          </div>

          <Link
            href="/dashboard"
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
          >
            Back to dashboard
          </Link>
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
          <div className="grid grid-cols-12 bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600 dark:bg-gray-900 dark:text-gray-300">
            <div className="col-span-4">Created</div>
            <div className="col-span-5">Quote ID</div>
            <div className="col-span-3 text-right">Action</div>
          </div>

          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {rows.length ? (
              rows.map((q) => (
                <li key={q.id} className="grid grid-cols-12 items-center px-4 py-3">
                  <div className="col-span-4 text-sm text-gray-800 dark:text-gray-200">
                    {q.createdAt ? new Date(q.createdAt).toLocaleString() : "—"}
                  </div>

                  <div className="col-span-5 font-mono text-xs text-gray-700 dark:text-gray-300">
                    {q.id}
                  </div>

                  <div className="col-span-3 flex justify-end">
                    <Link
                      href={`/admin/quotes/${q.id}`}
                      className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                    >
                      Review
                    </Link>
                  </div>
                </li>
              ))
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
