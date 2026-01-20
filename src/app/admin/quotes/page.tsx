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

function pickCustomer(input: any) {
  const c =
    input?.contact ??
    input?.customer ??
    input?.customer_context?.customer ??
    input?.lead ??
    input?.customer_context?.contact ??
    input?.contact_info ??
    {};

  const name =
    c?.name ??
    c?.fullName ??
    c?.customerName ??
    input?.name ??
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

  return {
    name: String(name || "New customer"),
    phone: phoneDigits ? formatUSPhone(phoneDigits) : null,
    phoneDigits: phoneDigits || null,
    email: email ? String(email) : null,
  };
}


// src/app/admin/quotes/page.tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs, tenants } from "@/lib/db/schema";

export const runtime = "nodejs";

function getCookieTenantId(jar: Awaited<ReturnType<typeof cookies>>) {
  const candidates = [
    jar.get("activeTenantId")?.value,
    jar.get("active_tenant_id")?.value,
    jar.get("tenantId")?.value,
    jar.get("tenant_id")?.value,
  ].filter(Boolean) as string[];

  return candidates[0] || null;
}

function fmtDate(isoOrDate: any) {
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return String(isoOrDate ?? "");
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Best-effort US-ish phone formatting without being opinionated */
function formatPhone(raw: unknown) {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  // Keep digits only for formatting checks
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  // If it's not a clean 10/11-digit US number, just show what we got
  return s;
}

/**
 * Pull customer + service/category from various possible shapes.
 * We intentionally support multiple keys so schema changes won't break the UI.
 */
function pickLead(input: any) {
  const c =
    input?.customer ??
    input?.customer_context?.customer ??
    input?.customer_context ??
    input?.lead ??
    input?.contact ??
    input?.form ??
    input ??
    {};

  const name =
    c?.name ??
    c?.fullName ??
    c?.customerName ??
    input?.name ??
    null;

  const phoneRaw =
    c?.phone ??
    c?.phoneNumber ??
    c?.mobile ??
    input?.phone ??
    input?.customer_context?.phone ??
    null;

  const email = c?.email ?? input?.email ?? null;

  const service =
    input?.customer_context?.service_type ??
    input?.service_type ??
    input?.serviceType ??
    input?.category ??
    input?.customer_context?.category ??
    null;

  const phone = formatPhone(phoneRaw);

  // Title: name > phone > email > "New customer"
  const title =
    (name && String(name).trim()) ||
    (phone && String(phone).trim()) ||
    (email && String(email).trim()) ||
    "New customer";

  // Subtitle: phone (if exists) + service/category (if exists)
  const subtitleParts: string[] = [];
  if (phone) subtitleParts.push(phone);
  if (service) subtitleParts.push(String(service));

  return {
    title,
    phone,
    email: email ? String(email) : null,
    service: service ? String(service) : null,
    subtitle: subtitleParts.join(" · "),
  };
}

function chip(label: string, tone: "gray" | "blue" | "green" | "red" | "yellow" = "gray") {
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

  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function renderChip(statusRaw: unknown) {
  const s = String(statusRaw ?? "").toLowerCase();
  if (s === "rendered") return chip("Rendered", "green");
  if (s === "failed") return chip("Render failed", "red");
  if (s === "queued" || s === "running") return chip("Rendering", "blue");
  return chip("Estimate", "gray");
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
  // You can tweak tones later (e.g., won green, lost red).
  if (st === "won") return chip(label, "green");
  if (st === "lost") return chip(label, "red");
  if (st === "new") return chip(label, "blue");
  return chip(label, "gray");
}

export default async function AdminQuotesPage() {
  const { userId } = await auth();
  if (!userId) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-5xl px-6 py-10">
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
        <div className="mx-auto max-w-5xl px-6 py-10">
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
      renderOptIn: quoteLogs.renderOptIn,
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
      <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Quotes</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Latest quotes for your tenant.{" "}
              {unreadCount > 0 ? (
                <span className="font-semibold text-gray-900 dark:text-gray-100">
                  ({unreadCount} unread)
                </span>
              ) : null}
            </p>
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
            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {rows.map((r) => {
                const lead = pickLead(r.input);
                const st = normalizeStage(r.stage);
                const unread = !r.isRead;

                // Keep the internal ID *available* but not in-your-face
                const shortId = String(r.id).slice(0, 8);

                return (
                  <li key={r.id} className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        {/* Title row */}
                        <div className="flex items-center gap-3">
                          <span
                            className={`mt-1 inline-block h-3 w-3 rounded-full ${
                              unread ? "bg-blue-600" : "bg-transparent border border-gray-300 dark:border-gray-700"
                            }`}
                            aria-label={unread ? "Unread" : "Read"}
                            title={unread ? "Unread" : "Read"}
                          />
                          <div className="min-w-0">
                            <div className="truncate text-lg font-semibold text-gray-900 dark:text-gray-100">
                              {lead.title}
                            </div>

                            {/* Subtitle */}
                            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                              {lead.subtitle ? (
                                <span>{lead.subtitle}</span>
                              ) : lead.email ? (
                                <span className="font-mono">{lead.email}</span>
                              ) : (
                                <span className="text-gray-500 dark:text-gray-400">—</span>
                              )}
                            </div>

                            {/* Created */}
                            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                              {fmtDate(r.createdAt)}
                            </div>

                            {/* Chips row */}
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {stageChip(st)}
                              {renderChip(r.renderStatus)}
                              {r.renderOptIn ? chip("Render opted-in", "blue") : null}
                            </div>

                            {/* tiny id */}
                            <div className="mt-3 text-xs text-gray-400 dark:text-gray-500">
                              {shortId}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0">
                        <Link
                          href={`/admin/quotes/${r.id}`}
                          className="rounded-xl bg-black px-6 py-3 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
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
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-300">
            No quotes yet. Run a test quote.
          </div>
        )}
      </div>
    </main>
  );
}
