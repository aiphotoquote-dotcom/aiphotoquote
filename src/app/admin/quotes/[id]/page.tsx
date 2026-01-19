import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs } from "@/lib/db/schema";

function getCookieTenantId(jar: Awaited<ReturnType<typeof cookies>>) {
  const candidates = [
    jar.get("activeTenantId")?.value,
    jar.get("active_tenant_id")?.value,
    jar.get("tenantId")?.value,
    jar.get("tenant_id")?.value,
  ].filter(Boolean) as string[];

  return candidates[0] || null;
}

function asStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

function fmtJson(value: unknown) {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value ?? "");
  }
}

type PageProps = {
  params: { id?: string };
};

export default async function AdminQuoteDetailPage({ params }: PageProps) {
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

  const jar = await cookies();
  const tenantId = getCookieTenantId(jar);

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

  const quoteId = asStr(params?.id);

  // ✅ Critical: never query with undefined/empty id
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

  // Pull the fields your DB actually has (matches your quote_logs schema reality)
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
    })
    .from(quoteLogs)
    .where(and(eq(quoteLogs.id, quoteId), eq(quoteLogs.tenantId, tenantId)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!row) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">Quote not found</h1>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Either this quote doesn’t exist, or it belongs to a different tenant.
              </p>
            </div>
            <Link
              href="/admin/quotes"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Back to quotes
            </Link>
          </div>

          <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-5 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
            <div className="font-mono text-xs">id: {quoteId}</div>
          </div>
        </div>
      </main>
    );
  }

  const created = row.createdAt ? new Date(row.createdAt).toLocaleString() : "—";
  const renderedAt = row.renderedAt ? new Date(row.renderedAt).toLocaleString() : null;

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Quote review</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Created {created}
            </p>
            <div className="mt-2 font-mono text-xs text-gray-600 dark:text-gray-400">
              {row.id}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/admin/quotes"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Back
            </Link>
            <Link
              href="/dashboard"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Dashboard
            </Link>
          </div>
        </div>

        {/* Rendering summary */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">AI rendering</h2>
            <div className="text-sm text-gray-700 dark:text-gray-300">
              Status:{" "}
              <span className="font-semibold">{row.renderStatus ?? "—"}</span>
              {row.renderOptIn ? (
                <span className="ml-2 rounded-full border border-gray-200 px-2 py-0.5 text-xs dark:border-gray-700">
                  Opted-in
                </span>
              ) : (
                <span className="ml-2 rounded-full border border-gray-200 px-2 py-0.5 text-xs dark:border-gray-700">
                  Not opted-in
                </span>
              )}
              {renderedAt ? (
                <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                  Rendered {renderedAt}
                </span>
              ) : null}
            </div>
          </div>

          {row.renderImageUrl ? (
            <div className="mt-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={row.renderImageUrl}
                alt="Rendered result"
                className="w-full max-w-2xl rounded-xl border border-gray-200 dark:border-gray-800"
              />
              <div className="mt-2">
                <Link
                  className="underline text-sm"
                  href={row.renderImageUrl}
                  target="_blank"
                >
                  Open image
                </Link>
              </div>
            </div>
          ) : null}

          {row.renderError ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
              <div className="font-semibold">Render error</div>
              <pre className="mt-2 whitespace-pre-wrap text-xs">{row.renderError}</pre>
            </div>
          ) : null}

          {row.renderPrompt ? (
            <div className="mt-4">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                Render prompt
              </div>
              <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800 dark:border-gray-800 dark:bg-black/40 dark:text-gray-200">
                {row.renderPrompt}
              </pre>
            </div>
          ) : null}
        </section>

        {/* Input/Output */}
        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
            <h2 className="font-semibold">Input</h2>
            <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800 dark:border-gray-800 dark:bg-black/40 dark:text-gray-200">
              {fmtJson(row.input)}
            </pre>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
            <h2 className="font-semibold">Output</h2>
            <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800 dark:border-gray-800 dark:bg-black/40 dark:text-gray-200">
              {fmtJson(row.output)}
            </pre>
          </div>
        </section>
      </div>
    </main>
  );
}
