// src/app/admin/quotes/[id]/page.tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";

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

function fmtJson(value: unknown) {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value ?? "");
  }
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

function pickLead(input: any) {
  const c =
    input?.customer ??
    input?.contact ??
    input?.customer_context?.customer ??
    input?.lead ??
    input?.contact ??
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

  return {
    name: String(name || "New customer"),
    phone: phoneDigits ? formatUSPhone(phoneDigits) : null,
    phoneDigits: phoneDigits || null,
    email: email ? String(email) : null,
  };
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

type StageKey = (typeof STAGES)[number]["key"];

function normalizeStage(s: unknown): StageKey {
  const v = String(s ?? "").toLowerCase().trim();
  const hit = STAGES.find((x) => x.key === v)?.key;
  return (hit ?? "new") as StageKey;
}

function stageLabel(stage: StageKey) {
  return STAGES.find((s) => s.key === stage)?.label ?? "New";
}

export default async function AdminQuoteDetailPage({
  params,
}: {
  params: Promise<{ id?: string }> | { id?: string };
}) {
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

  const resolvedParams = await params;
  const quoteIdParam = resolvedParams?.id;

  if (!quoteIdParam) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <h1 className="text-2xl font-semibold">Quote</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Missing quote id in URL.
          </p>
          <div className="mt-6">
            <Link className="underline" href="/admin/quotes">
              Back to quotes
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const jar = await cookies();
  let tenantIdMaybe = getCookieTenantId(jar);

  // Fallback: if cookie isn't set, use tenant owned by this user
  if (!tenantIdMaybe) {
    const t = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.ownerClerkUserId, userId))
      .limit(1)
      .then((r) => r[0] ?? null);

    tenantIdMaybe = t?.id ?? null;
  }

  if (!tenantIdMaybe) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <h1 className="text-2xl font-semibold">Quote</h1>
          <div className="mt-6 rounded-2xl border border-yellow-200 bg-yellow-50 p-5 text-sm text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
            No active tenant selected. Go to{" "}
            <Link className="underline" href="/onboarding">
              Settings
            </Link>{" "}
            and make sure your tenant is created/selected.
          </div>
          <div className="mt-6">
            <Link className="underline" href="/admin/quotes">
              Back to quotes
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // ✅ IMPORTANT: lock these as DEFINITELY strings for Drizzle eq(...)
  const quoteId = quoteIdParam; // string
  const tenantId = tenantIdMaybe; // string

  // Server action: update stage (also marks read)
  async function updateStage(formData: FormData) {
    "use server";
    const next = normalizeStage(formData.get("stage"));

    await db
      .update(quoteLogs)
      .set({ stage: next, isRead: true })
      .where(and(eq(quoteLogs.id, quoteId), eq(quoteLogs.tenantId, tenantId)));
  }

  // Server action: mark read on open
  async function markReadOnOpen() {
    "use server";
    await db
      .update(quoteLogs)
      .set({ isRead: true, stage: "read" })
      .where(and(eq(quoteLogs.id, quoteId), eq(quoteLogs.tenantId, tenantId)));
  }

  const row = await db
    .select({
      id: quoteLogs.id,
      createdAt: quoteLogs.createdAt,
      input: quoteLogs.input,
      output: quoteLogs.output,

      renderOptIn: quoteLogs.renderOptIn,
      renderStatus: quoteLogs.renderStatus,
      renderImageUrl: quoteLogs.renderImageUrl,
      renderPrompt: quoteLogs.renderPrompt,
      renderError: quoteLogs.renderError,
      renderedAt: quoteLogs.renderedAt,

      isRead: quoteLogs.isRead,
      stage: quoteLogs.stage,
    })
    .from(quoteLogs)
    .where(and(eq(quoteLogs.id, quoteId), eq(quoteLogs.tenantId, tenantId)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!row) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <h1 className="text-2xl font-semibold">Quote</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Quote not found for the active tenant.
          </p>
          <div className="mt-6">
            <Link className="underline" href="/admin/quotes">
              Back to quotes
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // Mark read on open (best-effort)
  if (!row.isRead) {
    try {
      await markReadOnOpen();
      row.isRead = true;
      if (normalizeStage(row.stage) === "new") row.stage = "read";
    } catch {
      // ignore (don’t block page render)
    }
  }

  const lead = pickLead(row.input);
  const stage = normalizeStage(row.stage);
  const unread = !row.isRead;
  const stageText = stageLabel(stage);

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Quote</h1>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={
                  "rounded-full border px-3 py-1 text-xs font-semibold " +
                  (unread
                    ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200"
                    : "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200")
                }
              >
                {unread ? "Unread" : "Read"}
              </span>

              <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200">
                Stage: {stageText}
              </span>
            </div>

            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              {row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}
            </p>

            <div className="mt-2 font-mono text-xs text-gray-600 dark:text-gray-400">
              {row.id}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/admin/quotes"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Back to quotes
            </Link>
          </div>
        </div>

        {/* Lead */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold">Customer</h2>
              <div className="mt-2 text-sm text-gray-800 dark:text-gray-200">
                <div className="text-lg font-semibold">{lead.name}</div>
                <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  {lead.phone ? (
                    <span className="font-mono">{lead.phone}</span>
                  ) : (
                    <span className="italic">No phone</span>
                  )}
                  {lead.email ? (
                    <>
                      {" "}
                      · <span className="font-mono">{lead.email}</span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            <form action={updateStage} className="flex items-center gap-2">
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                Stage
              </label>
              <select
                name="stage"
                defaultValue={stage}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
              >
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                Save
              </button>
            </form>
          </div>
        </section>

        {/* Render */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <h2 className="font-semibold">Render</h2>
          <div className="mt-2 text-sm text-gray-700 dark:text-gray-300">
            Opt-in: <b>{row.renderOptIn ? "true" : "false"}</b> · Status:{" "}
            <b>{row.renderStatus || "—"}</b>
          </div>

          {row.renderImageUrl ? (
            <div className="mt-4">
              <div className="text-xs text-gray-500">Render image</div>
              <a
                href={row.renderImageUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block underline text-sm"
              >
                Open render image
              </a>
            </div>
          ) : null}

          {row.renderError ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
              {row.renderError}
            </div>
          ) : null}
        </section>

        {/* Input */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <h2 className="font-semibold">Input</h2>
          <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-100">
            {fmtJson(row.input)}
          </pre>
        </section>

        {/* Output */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <h2 className="font-semibold">Output</h2>
          <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-100">
            {fmtJson(row.output)}
          </pre>
        </section>
      </div>
    </main>
  );
}