// src/components/admin/AdminTopNav.tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function getActiveTenantIdFromCookies(jar: Awaited<ReturnType<typeof cookies>>) {
  return (
    jar.get("activeTenantId")?.value ||
    jar.get("active_tenant_id")?.value ||
    jar.get("tenantId")?.value ||
    jar.get("tenant_id")?.value ||
    null
  );
}

export default async function AdminTopNav() {
  const { userId } = await auth();
  if (!userId) return null;

  // NOTE: This is "owner only" tenant discovery.
  // If you later add tenant_members RBAC, we can expand this query.
  const myTenants = await db
    .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.ownerClerkUserId, userId));

  const jar = await cookies();
  const activeTenantId = getActiveTenantIdFromCookies(jar);
  const activeTenant =
    (activeTenantId
      ? myTenants.find((t) => t.id === activeTenantId)
      : null) ?? myTenants[0] ?? null;

  // If cookie missing but we have a tenant, we can set it on next interaction.
  // We do NOT show active tenant name outside the switcher (per your choice).

  async function setActiveTenant(formData: FormData) {
    "use server";
    const nextId = String(formData.get("tenantId") ?? "").trim();
    if (!nextId) return;

    const jar = await cookies();
    jar.set("activeTenantId", nextId, {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
    });

    // bounce back to /admin/quotes (safe default)
    redirect("/admin/quotes");
  }

  const linkBase =
    "rounded-lg px-3 py-2 text-sm font-semibold transition-colors";
  const linkIdle =
    "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10";
  const linkActive =
    "bg-gray-900 text-white dark:bg-white dark:text-black";

  // Very lightweight "active" detection without usePathname (server component).
  // We keep it simple: user can still navigate easily even if highlight is not perfect.
  // If you want perfect highlighting, we’ll add a tiny client wrapper later.
  const activeKey = "quotes";

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/80 backdrop-blur dark:border-white/10 dark:bg-black/60">
      <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          {/* Left: Brand + Tenant Switcher (under brand, left side) */}
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/admin"
              className="shrink-0 text-sm font-black tracking-tight text-gray-900 dark:text-gray-100"
            >
              AI Photo Quote
            </Link>

            {/* Tenant switcher (name shown ONLY here) */}
            <form action={setActiveTenant} className="min-w-0">
              <label className="sr-only">Active tenant</label>
              <select
                name="tenantId"
                defaultValue={activeTenant?.id ?? ""}
                className={cn(
                  "max-w-[220px] truncate rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900",
                  "dark:border-white/10 dark:bg-black dark:text-gray-100"
                )}
              >
                {myTenants.length ? (
                  myTenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name || t.slug}
                    </option>
                  ))
                ) : (
                  <option value="">No tenants</option>
                )}
              </select>

              <button
                type="submit"
                className="ml-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/10"
              >
                Switch
              </button>
            </form>
          </div>

          {/* Center: Nav (desktop) */}
          <nav className="hidden items-center gap-1 md:flex">
            <Link
              href="/admin"
              className={cn(
                linkBase,
                activeKey === "dashboard" ? linkActive : linkIdle
              )}
            >
              Dashboard
            </Link>
            <Link
              href="/admin/quotes"
              className={cn(
                linkBase,
                activeKey === "quotes" ? linkActive : linkIdle
              )}
            >
              Quotes
            </Link>
            <Link
              href="/settings"
              className={cn(
                linkBase,
                activeKey === "settings" ? linkActive : linkIdle
              )}
            >
              Settings
            </Link>
            <Link
              href="/onboarding"
              className={cn(
                linkBase,
                activeKey === "setup" ? linkActive : linkIdle
              )}
            >
              Setup
            </Link>
          </nav>

          {/* Right: small mobile links */}
          <div className="flex items-center gap-2">
            <Link
              href="/admin/quotes"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/10 md:hidden"
            >
              Quotes
            </Link>
            <Link
              href="/onboarding"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/10 md:hidden"
            >
              Setup
            </Link>
          </div>
        </div>

        {/* Mobile secondary row (keeps nav usable without a drawer yet) */}
        <div className="mt-3 flex gap-2 md:hidden">
          <Link
            href="/admin"
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-center text-sm font-semibold hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/10"
          >
            Dashboard
          </Link>
          <Link
            href="/settings"
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-center text-sm font-semibold hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/10"
          >
            Settings
          </Link>
        </div>
      </div>
    </header>
  );
}