import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";

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

function pill(
  label: string,
  tone: "gray" | "green" | "yellow" | "red" | "blue" = "gray"
) {
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
    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function fmtDate(iso: unknown) {
  const s = typeof iso === "string" ? iso : iso instanceof Date ? iso.toISOString() : "";
  const d = new Date(s);
  if (!s || Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default async function AdminQuoteDetailPage({
  params,
}: {
  // ✅ Next can hand us params as a Promise in newer builds/runtimes
  params: { id: string } | Promise<{ id: string }>;
}) {
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

  // ✅ Robust: supports both object + Promise
  const resolvedParams = await Promise.resolve(params as any);
  const quoteId = resolvedParams?.id;

  if (!quoteId) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-5xl px-6 py-10">
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

  const row = await db
    .select({
      id: quoteLogs.id,
      tenantId: quoteLogs.tenantId,
      createdAt: quoteLogs.createdAt,
      input: quoteLogs.input,
      output: quoteLogs.output,
      renderOptIn: quoteLogs.renderOptIn,
      renderStatus: quoteLogs.renderStatus,
      renderImageUrl: quoteLogs.renderImageUrl,
      renderPrompt: quoteLogs.renderPrompt,
      renderError: quoteLogs.renderError,
      renderedAt: quoteLogs.renderedAt,
    })
    .from(quoteLogs)
    .where(and(eq(quoteLogs.id, quoteId), eq(quoteLogs.tenantId, tenantId)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!row) {
    // Optional: show “other tenant” hint by searching without tenant filter
    const existsElsewhere = await db
      .select({ id: quoteLogs.id, tenantId: quoteLogs.tenantId, createdAt: quoteLogs.createdAt })
      .from(quoteLogs)
      .where(eq(quoteLogs.id, quoteId))
      .orderBy(desc(quoteLogs.createdAt))
      .limit(1)
      .then((r) => r[0] ?? null);

    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">Quote not found</h1>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                This quote id doesn’t exist for the currently active tenant.
              </p>
              {existsElsewhere ? (
                <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                  Heads up: that quote id exists under a different tenant_id (
                  <span className="font-mono">{String(existsElsewhere.tenantId)}</span>).
                </p>
              ) : null}
            </div>

            <Link className="underline" href="/admin/quotes">
              Back to quotes
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const statusRaw = String(row.renderStatus ?? "not_requested").toLowerCase();
  const statusBadge =
    statusRaw === "rendered"
      ? pill("Rendered", "green")
      : statusRaw === "failed"
        ? pill("Render failed", "red")
        : statusRaw === "queued" || statusRaw === "running"
          ? pill("Rendering", "blue")
          : row.renderOptIn
            ? pill("Render requested", "yellow")
            : pill("Estimate only", "gray");

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Quote</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <div className="font-mono text-xs text-gray-600 dark:text-gray-400">{row.id}</div>
              {statusBadge}
            </div>

            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Created: <span className="font-semibold text-gray-800 dark:text-gray-200">{fmtDate(row.createdAt)}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/admin/quotes"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Back
            </Link>
          </div>
        </div>

        {/* Render panel */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold">Rendering</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Optional second step (tenant/customer opt-in).
              </p>
            </div>
            <div className="flex items-center gap-2">{statusBadge}</div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Opt-in</div>
              <div className="mt-1 text-sm">{row.renderOptIn ? "Yes" : "No"}</div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Rendered at</div>
              <div className="mt-1 text-sm">{fmtDate(row.renderedAt)}</div>
            </div>
          </div>

          {row.renderImageUrl ? (
            <div className="mt-5">
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Render output</div>
              <div className="mt-2 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={row.renderImageUrl}
                  alt="Rendered output"
                  className="w-full bg-black object-contain"
                />
              </div>
              <div className="mt-2 text-xs text-gray-600 dark:text-gray-400 break-all">
                {row.renderImageUrl}
              </div>
            </div>
          ) : null}

          {row.renderError ? (
            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200 whitespace-pre-wrap">
              {row.renderError}
            </div>
          ) : null}

          {row.renderPrompt ? (
            <div className="mt-5">
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Render prompt</div>
              <pre className="mt-2 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
                {row.renderPrompt}
              </pre>
            </div>
          ) : null}
        </section>

        {/* Input / Output JSON */}
        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
            <h2 className="font-semibold">Input</h2>
            <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
              {fmtJson(row.input)}
            </pre>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
            <h2 className="font-semibold">Output</h2>
            <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
              {fmtJson(row.output)}
            </pre>
          </div>
        </section>
      </div>
    </main>
  );
}
