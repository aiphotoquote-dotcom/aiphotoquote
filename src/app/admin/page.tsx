// src/app/admin/page.tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function digitsOnly(s: string) {
  return String(s || "").replace(/\D/g, "");
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
  if (s === "quote" || s === "quoted") return "quoted";
  if (s === "estimate" || s === "estimated") return "estimate";
  if (s === "read") return "read";
  if (s === "new") return "new";
  return s;
}

function stageChip(stageRaw: any) {
  const s = normalizeStage(stageRaw);

  const base =
    "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold";
  const cls =
    s === "new"
      ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
      : s === "read"
      ? "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
      : s === "estimate"
      ? "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200"
      : s === "quoted"
      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
      : "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200";

  const label =
    s === "new"
      ? "new"
      : s === "read"
      ? "read"
      : s === "estimate"
      ? "estimate"
      : s === "quoted"
      ? "quoted"
      : s;

  return <span className={cn(base, cls)}>{label}</span>;
}

function statusChip(isRead: boolean) {
  const base =
    "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold";
  const cls = isRead
    ? "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
    : "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200";
  return <span className={cn(base, cls)}>{isRead ? "Read" : "Unread"}</span>;
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

  const phoneDigits = phone ? digitsOnly(String(phone)) : "";
  const displayPhone = phoneDigits ? formatUSPhone(phoneDigits) : "";

  return {
    name: String(name || "New customer"),
    phone: displayPhone || "",
  };
}

function getTenantIdFromCookies(jar: Awaited<ReturnType<typeof cookies>>) {
  return (
    jar.get("activeTenantId")?.value ||
    jar.get("active_tenant_id")?.value ||
    jar.get("tenantId")?.value ||
    jar.get("tenant_id")?.value ||
    null
  );
}

export default async function AdminHomePage() {
  // Layout already guards auth, but keep this here too to be safe.
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const jar = await cookies();
  const tenantId = getTenantIdFromCookies(jar);

  // If no active tenant cookie, send them to setup (or onboarding).
  if (!tenantId) {
    redirect("/admin/setup");
  }

  // ---- Metrics ----
  const total = await db
    .select({ n: sql<number>`count(*)` })
    .from(quoteLogs)
    .where(eq(quoteLogs.tenantId, tenantId))
    .then((r) => Number(r?.[0]?.n ?? 0));

  const unread = await db
    .select({ n: sql<number>`count(*)` })
    .from(quoteLogs)
    .where(and(eq(quoteLogs.tenantId, tenantId), eq(quoteLogs.isRead, false)))
    .then((r) => Number(r?.[0]?.n ?? 0));

  const stageNew = await db
    .select({ n: sql<number>`count(*)` })
    .from(quoteLogs)
    .where(and(eq(quoteLogs.tenantId, tenantId), eq(quoteLogs.stage, "new")))
    .then((r) => Number(r?.[0]?.n ?? 0));

  const inProgressStages = ["read", "estimate", "quoted"];
  const inProgress = await db
    .select({ n: sql<number>`count(*)` })
    .from(quoteLogs)
    .where(
      and(eq(quoteLogs.tenantId, tenantId), inArray(quoteLogs.stage, inProgressStages))
    )
    .then((r) => Number(r?.[0]?.n ?? 0));

  // ---- Recent leads ----
  const recent = await db
    .select({
      id: quoteLogs.id,
      createdAt: quoteLogs.createdAt,
      isRead: quoteLogs.isRead,
      stage: quoteLogs.stage,
      input: quoteLogs.input,
    })
    .from(quoteLogs)
    .where(eq(quoteLogs.tenantId, tenantId))
    .orderBy(desc(quoteLogs.createdAt))
    .limit(8);

  const rows = recent.map((r) => {
    const lead = pickLead(r.input);
    return {
      id: String(r.id),
      createdAt: String(r.createdAt),
      isRead: Boolean(r.isRead),
      stage: String(r.stage ?? "new"),
      name: lead.name,
      phone: lead.phone,
    };
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            What’s happening today
          </p>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Quick snapshot of inbound leads and where they are in your pipeline.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/quotes"
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
          >
            View Quotes
          </Link>
          <Link
            href="/admin/settings"
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900"
          >
            Settings
          </Link>
          <Link
            href="/admin/setup"
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900"
          >
            Setup
          </Link>
        </div>
      </section>

      {/* KPI cards */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="TOTAL LEADS"
          value={total}
          sub="All-time for active tenant"
          tone="gray"
        />
        <KpiCard
          title="UNREAD"
          value={unread}
          sub="Needs attention"
          tone={unread > 0 ? "yellow" : "gray"}
        />
        <KpiCard
          title="NEW"
          value={stageNew}
          sub="Stage: New"
          tone={stageNew > 0 ? "blue" : "gray"}
        />
        <KpiCard
          title="IN PROGRESS"
          value={inProgress}
          sub="Read / Estimate / Quoted"
          tone={inProgress > 0 ? "green" : "gray"}
        />
      </section>

      {/* Recent leads */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Recent leads</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Latest submissions for the active tenant.
            </p>
          </div>

          <Link
            href="/admin/quotes"
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900"
          >
            Open full list
          </Link>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
          <div className="grid grid-cols-12 bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600 dark:bg-black dark:text-gray-300">
            <div className="col-span-5">Customer</div>
            <div className="col-span-2">Stage</div>
            <div className="col-span-3">Submitted</div>
            <div className="col-span-2 text-right">Status</div>
          </div>

          {rows.length ? (
            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className={cn(
                    "grid grid-cols-12 items-center px-4 py-3",
                    !r.isRead
                      ? "bg-yellow-50/60 dark:bg-yellow-950/20"
                      : "bg-white dark:bg-gray-950"
                  )}
                >
                  <div className="col-span-5">
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {r.name}
                    </div>
                    {r.phone ? (
                      <div className="text-sm text-gray-600 dark:text-gray-300">
                        {r.phone}
                      </div>
                    ) : null}
                    <div className="mt-1 text-xs font-mono text-gray-500 dark:text-gray-400">
                      {r.id}
                    </div>
                  </div>

                  <div className="col-span-2">{stageChip(r.stage)}</div>

                  <div className="col-span-3 text-sm text-gray-700 dark:text-gray-300">
                    {prettyDate(r.createdAt)}
                  </div>

                  <div className="col-span-2 flex justify-end">
                    {statusChip(r.isRead)}
                  </div>

                  <div className="col-span-12 mt-3 flex gap-2">
                    <Link
                      href={`/admin/quotes/${r.id}`}
                      className="rounded-lg bg-black px-3 py-2 text-xs font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                    >
                      Open
                    </Link>
                    <Link
                      href={`/admin/quotes`}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900"
                    >
                      View list
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 py-6 text-sm text-gray-600 dark:text-gray-300">
              No leads yet for this tenant. Submit a test quote to populate the dashboard.
            </div>
          )}
        </div>

        <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Tip: unread rows are lightly highlighted so you can scan faster.
        </div>
      </section>
    </div>
  );
}

function KpiCard({
  title,
  value,
  sub,
  tone,
}: {
  title: string;
  value: number;
  sub: string;
  tone: "gray" | "blue" | "green" | "yellow" | "red";
}) {
  const ring =
    tone === "blue"
      ? "border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/40"
      : tone === "green"
      ? "border-green-200 bg-green-50 dark:border-green-900/50 dark:bg-green-950/40"
      : tone === "yellow"
      ? "border-yellow-200 bg-yellow-50 dark:border-yellow-900/50 dark:bg-yellow-950/40"
      : tone === "red"
      ? "border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/40"
      : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950";

  return (
    <div className={cn("rounded-2xl border p-5 shadow-sm", ring)}>
      <div className="text-xs font-semibold tracking-wider text-gray-600 dark:text-gray-300">
        {title}
      </div>
      <div className="mt-3 text-3xl font-semibold text-gray-900 dark:text-gray-100">
        {value}
      </div>
      <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">{sub}</div>
    </div>
  );
}