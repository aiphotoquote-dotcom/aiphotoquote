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

function safeStr(v: any) {
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  return s.trim();
}

function pickCustomer(input: any) {
  // Try a bunch of likely shapes without breaking
  const name =
    safeStr(input?.customer?.name) ||
    safeStr(input?.customer_name) ||
    safeStr(input?.name) ||
    safeStr(input?.customer?.full_name) ||
    "";

  const phone =
    safeStr(input?.customer?.phone) ||
    safeStr(input?.phone) ||
    safeStr(input?.customer_phone) ||
    safeStr(input?.customer?.phone_number) ||
    "";

  const email =
    safeStr(input?.customer?.email) ||
    safeStr(input?.email) ||
    safeStr(input?.customer_email) ||
    "";

  const category =
    safeStr(input?.customer_context?.category) ||
    safeStr(input?.category) ||
    safeStr(input?.service_type) ||
    safeStr(input?.customer_context?.service_type) ||
    "";

  const labelName = name || (email ? email : "New customer");
  const labelPhone = phone || "No phone provided";

  return { name, phone, email, category, labelName, labelPhone };
}

function pill(label: string, tone: "gray" | "green" | "yellow" | "red" | "blue" = "gray") {
  const cls =
    tone === "green"
      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
      : tone === "yellow"
      ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200"
      : tone === "red"
      ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
      : tone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
      : "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200";

  return <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${cls}`}>{label}</span>;
}

function renderPill(statusRaw: unknown) {
  const s = String(statusRaw ?? "").toLowerCase();
  if (s === "rendered") return pill("Rendered", "green");
  if (s === "failed") return pill("Render failed", "red");
  if (s === "queued" || s === "running") return pill("Rendering", "blue");
  return pill("Estimate", "gray");
}

function stagePill(stageRaw: unknown) {
  const s = String(stageRaw ?? "new").toLowerCase();
  if (s === "new") return pill("New", "blue");
  if (s === "reviewing") return pill("Reviewing", "yellow");
  if (s === "quoted") return pill("Quoted", "gray");
  if (s === "scheduled") return pill("Scheduled", "gray");
  if (s === "won") return pill("Won", "green");
  if (s === "lost") return pill("Lost", "red");
  if (s === "archived") return pill("Archived", "gray");
  return pill(s, "gray");
}

export default async function AdminQuotesPage() {
  const { userId } = await auth();
  if (!userId) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">You must be signed in.</p>
          <div className="mt-6">
            <Link className="underline" href="/sign-in">Sign in</Link>
          </div>
        </div>
      </main>
    );
  }

  const tenantId = await resolveTenantId(userId);

  if (!tenantId) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <h1 className="text-2xl font-semibold">Quotes</h1>
          <div className="mt-6 rounded-2xl border border-yellow-200 bg-yellow-50 p-5 text-sm text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
            No active tenant selected. Go to{" "}
            <Link className="underline" href="/onboarding">Settings</Link>{" "}
            and make sure your tenant is created/selected.
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
      isRead: quoteLogs.isRead,
      stage: quoteLogs.stage,
    })
    .from(quoteLogs)
    .where(eq(quoteLogs.tenantId, tenantId))
    .orderBy(desc(quoteLogs.createdAt))
    .limit(60);

  const unreadCount = rows.filter((r) => !r.isRead).length;

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Quotes</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Latest quotes for your tenant.
              {unreadCount ? (
                <span className="ml-2 font-semibold text-gray-900 dark:text-gray-100">
                  ({unreadCount} unread)
                </span>
              ) : null}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
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

        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
          {/* Desktop header */}
          <div className="hidden md:grid md:grid-cols-12 bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600 dark:bg-black dark:text-gray-300">
            <div className="col-span-3">Created</div>
            <div className="col-span-5">Customer</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2 text-right">Action</div>
          </div>

          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {rows.length ? (
              rows.map((q) => {
                const c = pickCustomer(q.input);

                return (
                  <li key={q.id} className="px-4 py-4">
                    {/* Desktop row */}
                    <div className="hidden md:grid md:grid-cols-12 md:items-center md:gap-4">
                      <div className="col-span-3 text-sm text-gray-800 dark:text-gray-200">
                        {q.createdAt ? new Date(q.createdAt).toLocaleString() : "—"}
                      </div>

                      <div className="col-span-5">
                        <div className="flex items-center gap-2">
                          {!q.isRead ? (
                            <span className="inline-block h-2 w-2 rounded-full bg-blue-600" aria-label="Unread" />
                          ) : null}
                          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                            {c.labelName}
                          </div>
                          {c.category ? (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              · {c.category}
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                          {c.labelPhone}
                        </div>

                        <div className="mt-1 text-[11px] text-gray-400 font-mono break-all">
                          {q.id}
                        </div>
                      </div>

                      <div className="col-span-2 space-y-2">
                        <div>{stagePill(q.stage)}</div>
                        <div>{renderPill(q.renderStatus)}</div>
                      </div>

                      <div className="col-span-2 flex justify-end">
                        <Link
                          href={`/admin/quotes/${q.id}`}
                          className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                        >
                          Open
                        </Link>
                      </div>
                    </div>

                    {/* Mobile card */}
                    <div className="md:hidden space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            {!q.isRead ? (
                              <span className="inline-block h-2 w-2 rounded-full bg-blue-600" aria-label="Unread" />
                            ) : null}
                            <div className="text-base font-semibold">{c.labelName}</div>
                          </div>
                          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                            {c.labelPhone}
                            {c.category ? <span className="ml-2 text-xs text-gray-500">· {c.category}</span> : null}
                          </div>
                          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                            {q.createdAt ? new Date(q.createdAt).toLocaleString() : "—"}
                          </div>
                        </div>

                        <Link
                          href={`/admin/quotes/${q.id}`}
                          className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                        >
                          Open
                        </Link>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {stagePill(q.stage)}
                        {renderPill(q.renderStatus)}
                      </div>

                      <div className="text-[11px] text-gray-400 font-mono break-all">{q.id}</div>
                    </div>
                  </li>
                );
              })
            ) : (
              <li className="px-4 py-8 text-sm text-gray-600 dark:text-gray-300">
                No quotes yet. Run a test quote.
              </li>
            )}
          </ul>
        </section>
      </div>
    </main>
  );
}