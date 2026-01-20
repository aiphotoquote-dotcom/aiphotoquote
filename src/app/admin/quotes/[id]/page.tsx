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

function pickCustomer(input: any) {
  const c =
    input?.customer ??
    input?.customer_context?.customer ??
    input?.lead ??
    input?.contact ??
    {};

  const name =
    c?.name ?? c?.fullName ?? c?.customerName ?? input?.name ?? "Customer";

  const phone =
    c?.phone ??
    c?.phoneNumber ??
    input?.phone ??
    input?.customer_context?.phone ??
    null;

  const email = c?.email ?? input?.email ?? null;

  return {
    name: String(name || "Customer"),
    phone: phone ? String(phone) : null,
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

function normalizeStage(s: unknown) {
  const v = String(s ?? "").toLowerCase().trim();
  if (STAGES.some((x) => x.key === v)) return v;
  return "new";
}

// ---- server actions (typed args only; no undefined closures) ----
async function markRead(quoteId: string, tenantId: string) {
  "use server";
  await db
    .update(quoteLogs)
    .set({
      isRead: true,
      stage: "read",
    })
    .where(
      and(
        eq(quoteLogs.id, quoteId),
        eq(quoteLogs.tenantId, tenantId),
        eq(quoteLogs.isRead, false)
      )
    );
}

async function setStageAction(quoteId: string, tenantId: string, formData: FormData) {
  "use server";
  const next = normalizeStage(formData.get("stage"));
  await db
    .update(quoteLogs)
    .set({
      stage: next,
      isRead: true,
    })
    .where(and(eq(quoteLogs.id, quoteId), eq(quoteLogs.tenantId, tenantId)));
}

export default async function AdminQuoteDetailPage({
  params,
}: {
  // Next 16 can deliver params as an async value. Awaiting is safe either way.
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
  const quoteId = resolvedParams?.id;

  if (!quoteId) {
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

  // Load the quote
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

  // Mark read on open (best effort)
  if (!row.isRead) {
    try {
      await markRead(quoteId, tenantId);
      row.isRead = true;
      if (!row.stage || normalizeStage(row.stage) === "new") row.stage = "read";
    } catch {
      // ignore
    }
  }

  const customer = pickCustomer(row.input);
  const stage = normalizeStage(row.stage);
  const isUnread = !row.isRead && stage === "new";
  const stageLabel = STAGES.find((s) => s.key === stage)?.label ?? "New";

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
                  (row.isRead
                    ? "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
                    : "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200")
                }
              >
                {row.isRead ? "Read" : "Unread"}
              </span>

              <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200">
                Stage: {stageLabel}
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

        {/* Customer */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold">Customer</h2>
              <div className="mt-2 text-sm text-gray-800 dark:text-gray-200">
                <div className="text-lg font-semibold">{customer.name}</div>
                <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  {customer.phone ? (
                    <span className="font-mono">{customer.phone}</span>
                  ) : (
                    <span className="italic">No phone provided</span>
                  )}
                  {customer.email ? (
                    <>
                      {" "}
                      · <span className="font-mono">{customer.email}</span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Stage control */}
            <form
              action={setStageAction.bind(null, quoteId, tenantId)}
              className="flex items-center gap-2"
            >
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
