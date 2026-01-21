// src/app/admin/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { desc, eq, and, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function digitsOnly(s: string) {
  return (s || "").replace(/\D/g, "");
}

function formatUSPhone(raw: string) {
  const d = digitsOnly(raw).slice(0, 10);
  const a = d.slice(0, 3);
  const b = d.slice(3, 6);
  const c = d.slice(6, 10);
  if (!d) return "";
  if (d.length <= 3) return a ? `(${a}` : "";
  if (d.length <= 6) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}

function prettyDate(d: any) {
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return String(d ?? "");
    return dt.toLocaleString();
  } catch {
    return String(d ?? "");
  }
}

function normalizeStage(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "new";
  if (s === "quoted" || s === "quote") return "quoted";
  if (s === "read") return "read";
  if (s === "new") return "new";
  if (s === "estimate" || s === "estimated") return "estimate";
  if (s === "closed") return "closed";
  return s;
}

function stageChip(stageRaw: unknown) {
  const st = normalizeStage(stageRaw);
  const base = "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold";

  if (st === "new")
    return cn(
      base,
      "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
    );
  if (st === "read")
    return cn(
      base,
      "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
    );
  if (st === "estimate")
    return cn(
      base,
      "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200"
    );
  if (st === "quoted")
    return cn(
      base,
      "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
    );
  if (st === "closed")
    return cn(
      base,
      "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200"
    );

  return cn(
    base,
    "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
  );
}

function pickLead(input: any) {
  const c = input?.customer ?? input?.contact ?? input ?? null;

  const name =
    c?.name ??
    input?.name ??
    input?.customer_name ??
    input?.customerName ??
    null;

  const phone =
    c?.phone ??
    c?.phoneNumber ??
    input?.phone ??
    input?.customer_phone ??
    input?.customerPhone ??
    input?.customer_context?.phone ??
    null;

  const email =
    c?.email ??
    input?.email ??
    input?.customer_email ??
    input?.customerEmail ??
    input?.customer_context?.email ??
    null;

  const phoneDigits = phone ? digitsOnly(String(phone)) : "";

  return {
    name: String(name || "New customer"),
    phone: phoneDigits ? formatUSPhone(phoneDigits) : null,
    email: email ? String(email) : null,
  };
}

async function getActiveTenantIdFromCookies(): Promise<string | null> {
  // NOTE: In your environment this is a Promise (we’ve seen TS errors if not awaited)
  const c = await cookies();

  return (
    c.get("activeTenantId")?.value ||
    c.get("active_tenant_id")?.value ||
    c.get("activeTenant")?.value ||
    c.get("active_tenant")?.value ||
    null
  );
}

function MetricCard({
  title,
  value,
  hint,
  href,
}: {
  title: string;
  value: string;
  hint?: string;
  href?: string;
}) {
  const inner = (
    <div
      className={cn(
        "rounded-2xl border border-gray-200 bg-white p-5 shadow-sm",
        "dark:border-gray-800 dark:bg-gray-900"
      )}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {title}
      </div>
      <div className="mt-2 text-3xl font-semibold text-gray-900 dark:text-gray-100">{value}</div>
      {hint ? (
        <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">{hint}</div>
      ) : null}
    </div>
  );

  if (!href) return inner;

  return (
    <Link href={href} className="block transition hover:-translate-y-[1px] hover:shadow-md">
      {inner}
    </Link>
  );
}

export default async function AdminDashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const tenantId = await getActiveTenantIdFromCookies();

  // If no active tenant is selected, show a friendly “pick tenant” message.
  // This prevents crashes and still gives a polished landing.
  if (!tenantId) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Select a tenant to see metrics and recent leads.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/admin/quotes"
              className="rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white dark:bg-white dark:text-black"
            >
              Go to Quotes
            </Link>
            <Link
              href="/admin/setup"
              className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold dark:border-gray-800"
            >
              Go to Setup
            </Link>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard title="Total Leads" value="—" hint="Select tenant" />
          <MetricCard title="Unread" value="—" hint="Select tenant" />
          <MetricCard title="New" value="—" hint="Select tenant" />
          <MetricCard title="In Progress" value="—" hint="Select tenant" />
        </div>
      </div>
    );
  }

  // Fetch metrics + recent leads for the active tenant
  // Keep this resilient; never throw a hard 500 just for dashboard UI.
  let total = 0;
  let unread = 0;
  let stageNew = 0;
  let inProgress = 0;

  let recent: Array<{
    id: string;
    createdAt: any;
    isRead: boolean;
    stage: any;
    input: any;
    renderStatus: any;
  }> = [];

  let dashError: string | null = null;

  try {
    // Recent leads (and also used for counts cheaply if you want)
    recent = await db
      .select({
        id: quoteLogs.id,
        createdAt: quoteLogs.createdAt,
        isRead: quoteLogs.isRead,
        stage: quoteLogs.stage,
        input: quoteLogs.input,
        renderStatus: quoteLogs.renderStatus,
      })
      .from(quoteLogs)
      .where(eq(quoteLogs.tenantId, tenantId))
      .orderBy(desc(quoteLogs.createdAt))
      .limit(8);

    // Counts (simple + explicit)
    const allRows = await db
      .select({
        isRead: quoteLogs.isRead,
        stage: quoteLogs.stage,
      })
      .from(quoteLogs)
      .where(eq(quoteLogs.tenantId, tenantId));

    total = allRows.length;
    unread = allRows.reduce((acc, r) => acc + (r.isRead ? 0 : 1), 0);
    stageNew = allRows.reduce((acc, r) => acc + (normalizeStage(r.stage) === "new" ? 1 : 0), 0);

    // “In progress” = read/estimate/quoted (not new, not closed)
    inProgress = allRows.reduce((acc, r) => {
      const st = normalizeStage(r.stage);
      return acc + (st === "read" || st === "estimate" || st === "quoted" ? 1 : 0);
    }, 0);
  } catch (e: any) {
    dashError = e?.message ?? String(e);
  }

  return (
    <div className="space-y-6">
      {/* Hero / Centerpiece */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
              <span className="inline-block h-2 w-2 rounded-full bg-green-600" />
              Admin Dashboard
            </div>

            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
              What’s happening today
            </h1>

            <p className="mt-2 max-w-2xl text-sm text-gray-600 dark:text-gray-300">
              Quick snapshot of inbound leads and where they are in your pipeline.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin/quotes"
              className="rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white dark:bg-white dark:text-black"
            >
              View Quotes
            </Link>
            <Link
              href="/admin/settings"
              className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold dark:border-gray-800"
            >
              Settings
            </Link>
            <Link
              href="/admin/setup"
              className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold dark:border-gray-800"
            >
              Setup
            </Link>
          </div>
        </div>

        {dashError ? (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
            Dashboard metrics failed to load: {dashError}
          </div>
        ) : null}
      </div>

      {/* Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Total Leads" value={String(total)} hint="All-time for active tenant" href="/admin/quotes" />
        <MetricCard title="Unread" value={String(unread)} hint="Needs attention" href="/admin/quotes?filter=unread" />
        <MetricCard title="New" value={String(stageNew)} hint="Stage: New" href="/admin/quotes?stage=new" />
        <MetricCard title="In Progress" value={String(inProgress)} hint="Read / Estimate / Quoted" href="/admin/quotes" />
      </div>

      {/* Recent leads */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between gap-4 border-b border-gray-200 p-5 dark:border-gray-800">
          <div>
            <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">Recent leads</div>
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Latest submissions for the active tenant.
            </div>
          </div>
          <Link
            href="/admin/quotes"
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold dark:border-gray-800"
          >
            Open full list
          </Link>
        </div>

        <div className="overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600 dark:bg-gray-950 dark:text-gray-300">
              <tr>
                <th className="px-5 py-3 font-semibold">Customer</th>
                <th className="px-5 py-3 font-semibold">Stage</th>
                <th className="px-5 py-3 font-semibold">Submitted</th>
                <th className="px-5 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {recent.length ? (
                recent.map((r) => {
                  const lead = pickLead(r.input);
                  const st = normalizeStage(r.stage);
                  const unreadRow = !r.isRead;

                  return (
                    <tr key={r.id} className={cn(unreadRow && "bg-blue-50/40 dark:bg-blue-950/20")}>
                      <td className="px-5 py-4">
                        <Link href={`/admin/quotes/${r.id}`} className="font-semibold text-gray-900 dark:text-gray-100">
                          {lead.name}
                        </Link>
                        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                          {lead.phone ? lead.phone : lead.email ? lead.email : "—"}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className={stageChip(st)}>{st}</span>
                      </td>
                      <td className="px-5 py-4 text-gray-700 dark:text-gray-200">{prettyDate(r.createdAt)}</td>
                      <td className="px-5 py-4">
                        {unreadRow ? (
                          <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200">
                            Unread
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
                            Read
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="px-5 py-6 text-gray-600 dark:text-gray-300" colSpan={4}>
                    No leads yet for this tenant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t border-gray-200 p-5 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
          Tip: unread rows are lightly highlighted so you can scan faster.
        </div>
      </div>
    </div>
  );
}