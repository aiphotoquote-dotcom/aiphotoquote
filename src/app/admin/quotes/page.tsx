// src/app/admin/quotes/page.tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs, tenants } from "@/lib/db/schema";

export const runtime = "nodejs";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function getCookieTenantId(jar: Awaited<ReturnType<typeof cookies>>) {
  const candidates = [
    jar.get("activeTenantId")?.value,
    jar.get("active_tenant_id")?.value,
    jar.get("tenantId")?.value,
    jar.get("tenant_id")?.value,
  ].filter(Boolean) as string[];

  return candidates[0] || null;
}

function digitsOnly(s: string) {
  return (s || "").replace(/\D/g, "");
}

function formatUSPhone(raw: string) {
  const d = digitsOnly(raw).slice(0, 10);
  const a = d.slice(0, 3);
  const b = d.slice(3, 6);
  const c = d.slice(6, 10);
  if (d.length <= 3) return a ? `(${a}` : "";
  if (d.length <= 6) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}

function fmtDate(iso: unknown) {
  const s = String(iso ?? "");
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s || "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const STAGES = [
  { key: "new", label: "New" },
  { key: "read", label: "Read" },
  { key: "contacted", label: "Contacted" },
  { key: "scheduled", label: "Scheduled" },
  { key: "quoted", label: "Quoted" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "archived", label: "Archived" },
] as const;

function normalizeStage(s: unknown) {
  const v = String(s ?? "").toLowerCase().trim();
  if (STAGES.some((x) => x.key === v)) return v;
  return "new";
}

function stageChip(stageRaw: unknown) {
  const st = normalizeStage(stageRaw);
  const label = STAGES.find((x) => x.key === st)?.label ?? "New";

  // Keep stage visually distinct from render by using blue-ish as default.
  const cls =
    st === "won"
      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
      : st === "lost"
        ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
        : st === "archived"
          ? "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
          : "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200";

  return (
    <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", cls)}>
      {label}
    </span>
  );
}

function renderChip(statusRaw: unknown) {
  const s = String(statusRaw ?? "").toLowerCase();
  const cls =
    s === "rendered"
      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
      : s === "failed"
        ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
        : s === "queued" || s === "running"
          ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200"
          : "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200";

  const label =
    s === "rendered"
      ? "Rendered"
      : s === "failed"
        ? "Render failed"
        : s === "queued" || s === "running"
          ? "Rendering"
          : "Estimate";

  return (
    <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", cls)}>
      {label}
    </span>
  );
}

function pickLead(input: any) {
  // Supports multiple shapes:
  // - NEW server route stores: input.customer {name,phone,email}
  // - QuoteForm currently sends: contact {name,email,phone}
  // - Older shapes: input.name/email/phone or input.customer_context.*
  const c =
    input?.customer ??
    input?.contact ??
    input?.lead ??
    input?.customer_context?.customer ??
    input?.customer_context?.lead ??
    input?.customer_context?.contact ??
    {};

  const name =
    c?.name ??
    c?.fullName ??
    c?.customerName ??
    input?.name ??
    input?.customer_context?.name ??
    "New customer";

  const phone =
    c?.phone ??
    c?.phoneNumber ??
    input?.phone ??
    input?.customer_context?.phone ??
    null;

  const email =
    c?.email ??
    input?.email ??
    input?.customer_context?.email ??
    null;

  const phoneDigits = phone ? digitsOnly(String(phone)) : "";

  // Title: name > phone > email > "New customer"
  const title =
    (String(name || "").trim() ||
      (phoneDigits ? formatUSPhone(phoneDigits) : "") ||
      (email ? String(email) : "") ||
      "New customer");

  return {
    title,
    name: String(name || "New customer"),
    phone: phoneDigits ? formatUSPhone(phoneDigits) : null,
    phoneDigits: phoneDigits || null,
    email: email ? String(email) : null,
  };
}

export default async function AdminQuotesPage() {
  const { userId } = await auth();
  if (!userId) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <h1 className="text-2xl font-semibold">Quotes</h1>
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

  if (!tenantId) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <h1 className="text-2xl font-semibold">Quotes</h1>
          <div className="mt-6 rounded-2xl border border-yellow-200 bg-yellow-50 p-5 text-sm text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
            No active tenant selected. Go to{" "}
            <Link className="underline" href="/onboarding">
              Settings
            </Link>{" "}
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
      isRead: quoteLogs.isRead,
      stage: quoteLogs.stage,
    })
    .from(quoteLogs)
    .where(eq(quoteLogs.tenantId, tenantId))
    .orderBy(desc(quoteLogs.createdAt))
    .limit(200);

  const unreadCount = rows.reduce((acc, r) => acc + (r.isRead ? 0 : 1), 0);

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Quotes</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Incoming customer requests for your active tenant.
            </p>
            <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
              Unread: <span className="font-semibold">{unreadCount}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
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

        {/* List */}
        {rows.length ? (
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
            <div className="grid grid-cols-12 bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600 dark:bg-black dark:text-gray-300">
              <div className="col-span-5">Customer</div>
              <div className="col-span-3">Created</div>
              <div className="col-span-4 text-right">Status</div>
            </div>

            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {rows.map((r) => {
                const lead = pickLead(r.input);
                const st = normalizeStage(r.stage);
                const unread = !r.isRead;

                return (
                  <li key={r.id} className="px-4 py-4">
                    <div className="grid grid-cols-12 items-center gap-3">
                      {/* Customer */}
                      <div className="col-span-12 sm:col-span-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/admin/quotes/${r.id}`}
                            className={cn(
                              "text-sm font-semibold underline-offset-2 hover:underline",
                              unread ? "text-gray-900 dark:text-gray-100" : "text-gray-800 dark:text-gray-200"
                            )}
                          >
                            {lead.title}
                          </Link>

                          {unread ? (
                            <span className="rounded-full border border-yellow-200 bg-yellow-50 px-3 py-1 text-xs font-semibold text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
                              Unread
                            </span>
                          ) : (
                            <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
                              Read
                            </span>
                          )}
                        </div>

                        <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                          {lead.phone ? <span className="font-mono">{lead.phone}</span> : <span className="italic">No phone</span>}
                          {lead.email ? (
                            <>
                              {" "}
                              · <span className="font-mono">{lead.email}</span>
                            </>
                          ) : null}
                        </div>
                      </div>

                      {/* Created */}
                      <div className="col-span-6 sm:col-span-3 text-sm text-gray-700 dark:text-gray-300">
                        {fmtDate(r.createdAt)}
                      </div>

                      {/* Status */}
                      <div className="col-span-6 sm:col-span-4 flex items-center justify-end gap-2">
                        {stageChip(st)}
                        {renderChip(r.renderStatus)}
                        <Link
                          href={`/admin/quotes/${r.id}`}
                          className="ml-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                        >
                          Open
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-300">
            No quotes yet. Submit a test quote from your public page.
          </div>
        )}
      </div>
    </main>
  );
}
