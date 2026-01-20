// src/app/admin/page.tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getCookieTenantId(jar: Awaited<ReturnType<typeof cookies>>) {
  const candidates = [
    jar.get("activeTenantId")?.value,
    jar.get("active_tenant_id")?.value,
    jar.get("tenantId")?.value,
    jar.get("tenant_id")?.value,
  ].filter(Boolean) as string[];

  return candidates[0] || null;
}

export default async function AdminHomePage() {
  const { userId } = await auth();

  if (!userId) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">You must be signed in.</p>
          <div className="mt-6">
            <Link className="underline" href="/sign-in">
              Sign in
            </Link>
          </div>
        </div>
      </main>
    );
  }

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

  const activeTenant =
    tenantId
      ? await db
          .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : null;

  const hasActiveTenant = Boolean(activeTenant?.id);

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <div className="mx-auto max-w-5xl px-6 py-10 space-y-8">
        {/* Header */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Admin</h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Manage quotes and tenant settings.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/admin/quotes"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Quotes
            </Link>
            <Link
              href="/onboarding"
              className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
            >
              Settings
            </Link>
          </div>
        </header>

        {/* Active tenant */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold">Active tenant</h2>

              {hasActiveTenant ? (
                <>
                  <div className="mt-2 text-lg font-semibold">{activeTenant?.name ?? "Unnamed tenant"}</div>
                  <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    <span className="font-mono text-xs">{activeTenant?.id}</span>
                  </div>
                  {activeTenant?.slug ? (
                    <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      <span className="font-semibold">Slug:</span>{" "}
                      <span className="font-mono">{activeTenant.slug}</span>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="mt-3 rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
                  No active tenant selected. Go to{" "}
                  <Link className="underline" href="/onboarding">
                    Settings
                  </Link>{" "}
                  and make sure your tenant is created/selected.
                </div>
              )}
            </div>

            <div className="flex flex-col items-end gap-2">
              <div className="text-xs text-gray-500 dark:text-gray-400">Tenant context</div>
              <div className={"text-sm font-semibold " + (hasActiveTenant ? "" : "opacity-60")}>
                {hasActiveTenant ? "Ready" : "Needs setup"}
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href="/admin/quotes"
              className={
                "rounded-lg border px-4 py-2 text-sm font-semibold " +
                "border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900 " +
                (!hasActiveTenant ? "opacity-60 pointer-events-none" : "")
              }
            >
              View quotes
            </Link>

            <Link
              href="/onboarding"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Change tenant
            </Link>
          </div>
        </section>

        {/* Quick links */}
        <section className="grid gap-4 sm:grid-cols-2">
          <Link
            href="/admin/quotes"
            className={
              "rounded-2xl border border-gray-200 bg-white p-6 hover:bg-gray-50 " +
              "dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900 " +
              (!hasActiveTenant ? "opacity-60 pointer-events-none" : "")
            }
          >
            <div className="text-sm font-semibold">Quotes</div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Review incoming leads, stages, and rendering status.
            </div>
          </Link>

          <Link
            href="/onboarding"
            className="rounded-2xl border border-gray-200 bg-white p-6 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900"
          >
            <div className="text-sm font-semibold">Settings</div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Business info, reporting defaults, AI rendering toggle.
            </div>
          </Link>
        </section>
      </div>
    </main>
  );
}