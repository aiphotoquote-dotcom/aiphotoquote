import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";

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

function fmtJson(value: unknown) {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function pickCustomer(input: any): { name: string; phone: string; email: string } {
  const c = input?.customer ?? input?.customer_context ?? input?.contact ?? input ?? {};
  const name =
    String(c?.name ?? c?.full_name ?? c?.fullName ?? c?.customer_name ?? c?.customerName ?? "")
      .trim() || "New customer";

  const phone =
    String(c?.phone ?? c?.phone_number ?? c?.phoneNumber ?? c?.mobile ?? "")
      .trim() || "";

  const email =
    String(c?.email ?? c?.email_address ?? c?.emailAddress ?? "")
      .trim() || "";

  return { name, phone, email };
}

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
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

  return <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", cls)}>{label}</span>;
}

function stageLabel(stageRaw: unknown) {
  const s = String(stageRaw ?? "new").toLowerCase();
  if (s === "new") return pill("New", "blue");
  if (s === "open") return pill("Open", "gray");
  if (s === "in_progress") return pill("In progress", "yellow");
  if (s === "sent") return pill("Sent", "green");
  if (s === "closed") return pill("Closed", "gray");
  return pill(s, "gray");
}

function renderLabel(statusRaw: unknown) {
  const s = String(statusRaw ?? "").toLowerCase();
  if (s === "rendered") return pill("Rendered", "green");
  if (s === "failed") return pill("Render failed", "red");
  if (s === "queued" || s === "running") return pill("Rendering", "blue");
  return pill("Estimate", "gray");
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
        <div className="mx-auto max-w-6xl px-6 py-10">
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

  const resolvedParams = await params;
  const quoteId = resolvedParams?.id;

  if (!quoteId) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <h1 className="text-2xl font-semibold">Quote</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Missing quote id in URL.</p>
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

  // fallback: tenant owned by this user
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

      // NEW fields
      isRead: (quoteLogs as any).isRead,
      readAt: (quoteLogs as any).readAt,
      stage: (quoteLogs as any).stage,
    })
    .from(quoteLogs)
    .where(and(eq(quoteLogs.id, quoteId), eq(quoteLogs.tenantId, tenantId)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!row) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-6xl px-6 py-10">
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

  // Mark as read on first view (best-effort)
  try {
    if (!(row as any).isRead) {
      await db
        .update(quoteLogs)
        .set({ ...( { isRead: true, readAt: new Date() } as any ) })
        .where(and(eq(quoteLogs.id, quoteId), eq(quoteLogs.tenantId, tenantId)));
    }
  } catch {
    // ignore (non-blocking)
  }

  const customer = pickCustomer(row.input);
  const stage = String((row as any).stage ?? "new");
  const isRead = Boolean((row as any).isRead);

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{customer.name}</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              {row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}
            </p>
            <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">
              {customer.phone ? <span className="font-mono">{customer.phone}</span> : <span className="italic">No phone</span>}
              {customer.email ? <span className="ml-2">· {customer.email}</span> : null}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {stageLabel(stage)}
              {renderLabel(row.renderStatus)}
              {row.renderOptIn ? pill("Opt-in", "yellow") : null}
              {isRead ? pill("Read", "gray") : pill("Unread", "blue")}
            </div>

            <div className="mt-3 font-mono text-[11px] text-gray-500 dark:text-gray-400">
              {row.id}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/admin/quotes"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Back to quotes
            </Link>

            <form action={`/api/admin/quotes/${row.id}/stage`} method="post">
              <select
                name="stage"
                defaultValue={stage}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-950"
              >
                <option value="new">new</option>
                <option value="open">open</option>
                <option value="in_progress">in_progress</option>
                <option value="sent">sent</option>
                <option value="closed">closed</option>
              </select>
              <button
                type="submit"
                className="ml-2 rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                Update stage
              </button>
            </form>
          </div>
        </div>

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

          {row.renderPrompt ? (
            <div className="mt-4">
              <div className="text-xs text-gray-500">Prompt</div>
              <pre className="mt-2 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-100">
                {String(row.renderPrompt)}
              </pre>
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <h2 className="font-semibold">Input</h2>
          <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-100">
            {fmtJson(row.input)}
          </pre>
        </section>

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
