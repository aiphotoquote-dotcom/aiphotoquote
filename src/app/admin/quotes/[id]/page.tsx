import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";

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

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s
  );
}

function badge(label: string) {
  return (
    <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
      {label}
    </span>
  );
}

export default async function AdminQuoteDetailPage({
  params,
}: {
  params: { id: string };
}) {
  // Clerk session (server)
  const { userId } = await auth();
  if (!userId) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            You must be signed in to view this page.
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

  // ✅ IMPORTANT: read the dynamic segment from params.id
  const quoteId = params?.id ? String(params.id) : "";

  // Guard against undefined/invalid IDs so we never pass undefined into Drizzle
  if (!quoteId || !isUuid(quoteId)) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold">Quote</h1>
            <Link
              href="/admin/quotes"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Back to quotes
            </Link>
          </div>

          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
            Invalid quote id in URL.
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
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold">Quote</h1>
            <Link
              href="/admin/quotes"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Back to quotes
            </Link>
          </div>

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

  // Fetch the row
  const rows = await db
    .select({
      id: quoteLogs.id,
      tenantId: quoteLogs.tenantId,
      input: quoteLogs.input,
      output: quoteLogs.output,
      renderOptIn: quoteLogs.renderOptIn,
      renderStatus: quoteLogs.renderStatus,
      renderImageUrl: quoteLogs.renderImageUrl,
      renderPrompt: quoteLogs.renderPrompt,
      renderError: quoteLogs.renderError,
      renderedAt: quoteLogs.renderedAt,
      createdAt: quoteLogs.createdAt,
    })
    .from(quoteLogs)
    .where(and(eq(quoteLogs.id, quoteId), eq(quoteLogs.tenantId, tenantId)))
    .limit(1);

  const row = rows[0] || null;

  if (!row) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold">Quote</h1>
            <Link
              href="/admin/quotes"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Back to quotes
            </Link>
          </div>

          <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-5 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
            Quote not found for the active tenant.
          </div>
        </div>
      </main>
    );
  }

  const status = String(row.renderStatus || "not_requested");

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Quote review</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {badge(`Status: ${status}`)}
              {badge(`Render opt-in: ${row.renderOptIn ? "yes" : "no"}`)}
            </div>

            <div className="mt-3 text-xs text-gray-500 dark:text-gray-400 font-mono">
              {row.id}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin/quotes"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Back to quotes
            </Link>
          </div>
        </div>

        {/* Render preview (if exists) */}
        {row.renderImageUrl ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
            <h2 className="font-semibold">Rendered image</h2>
            <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={row.renderImageUrl}
                alt="Rendered result"
                className="w-full"
              />
            </div>
          </section>
        ) : null}

        {/* Output */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <h2 className="font-semibold">Output</h2>
          <pre className="mt-4 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
            {JSON.stringify(row.output ?? null, null, 2)}
          </pre>
        </section>

        {/* Input */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <h2 className="font-semibold">Input</h2>
          <pre className="mt-4 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
            {JSON.stringify(row.input ?? null, null, 2)}
          </pre>
        </section>

        {/* Render debug */}
        {(row.renderPrompt || row.renderError || row.renderedAt) && (
          <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
            <h2 className="font-semibold">Render debug</h2>

            {row.renderedAt ? (
              <div className="mt-3 text-sm text-gray-700 dark:text-gray-300">
                Rendered at:{" "}
                <span className="font-mono text-xs">{String(row.renderedAt)}</span>
              </div>
            ) : null}

            {row.renderPrompt ? (
              <>
                <div className="mt-4 text-sm font-semibold">Prompt</div>
                <pre className="mt-2 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
                  {String(row.renderPrompt)}
                </pre>
              </>
            ) : null}

            {row.renderError ? (
              <>
                <div className="mt-4 text-sm font-semibold text-red-700 dark:text-red-300">
                  Error
                </div>
                <pre className="mt-2 overflow-auto rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                  {String(row.renderError)}
                </pre>
              </>
            ) : null}
          </section>
        )}
      </div>
    </main>
  );
}
