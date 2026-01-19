import TopNav from "@/components/TopNav";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { quoteLogs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUuid(v: string) {
  // uuid v1-v5
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function fmtDate(v: unknown) {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function pretty(obj: any) {
  try {
    return JSON.stringify(obj ?? null, null, 2);
  } catch {
    return String(obj);
  }
}

type PageProps = { params: Promise<{ id: string }> };

export default async function AdminQuoteDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.userId) redirect("/sign-in");

  const { id } = await params;

  const uuidOk = isUuid(id);

  let row: any = null;
  let dbError: string | null = null;

  if (uuidOk) {
    try {
      const rows = await db
        .select({
          id: quoteLogs.id,
          tenantId: quoteLogs.tenantId,
          input: quoteLogs.input,
          output: quoteLogs.output,
          createdAt: quoteLogs.createdAt,

          // render fields (present in your real DB)
          renderOptIn: quoteLogs.renderOptIn,
          renderStatus: quoteLogs.renderStatus,
          renderImageUrl: quoteLogs.renderImageUrl,
          renderPrompt: quoteLogs.renderPrompt,
          renderError: quoteLogs.renderError,
          renderedAt: quoteLogs.renderedAt,
        })
        .from(quoteLogs)
        .where(eq(quoteLogs.id, id))
        .limit(1);

      row = rows?.[0] ?? null;
    } catch (e: any) {
      dbError = e?.message ?? String(e);
    }
  }

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Admin · Quote</h1>
            <div className="mt-1 font-mono text-xs text-gray-600 dark:text-gray-400 break-all">
              {id}
            </div>
          </div>

          <Link
            href="/admin/quotes"
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
          >
            ← Back
          </Link>
        </div>

        {/* Self-diagnosis (THIS is why we won’t 404 anymore) */}
        {!uuidOk ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
            This URL param is not a valid UUID, so the DB lookup was skipped.
          </div>
        ) : dbError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200 whitespace-pre-wrap">
            DB error while loading quote:
            {"\n"}
            {dbError}
          </div>
        ) : !row ? (
          <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-5 text-sm text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
            No quote found for this ID in the connected database.
            <div className="mt-2 text-xs opacity-90">
              If the list page shows this ID but detail says not found, your list page and detail
              page are likely pointing at different DB/env OR the detail page previously called
              notFound().
            </div>
          </div>
        ) : null}

        {row ? (
          <div className="grid gap-6">
            <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
              <h2 className="font-semibold">Summary</h2>
              <div className="mt-3 grid gap-3 text-sm text-gray-800 dark:text-gray-200">
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Created:</span>{" "}
                  {fmtDate(row.createdAt)}
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Tenant ID:</span>{" "}
                  <span className="font-mono text-xs">{row.tenantId}</span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Render:</span>{" "}
                  <span className="font-mono text-xs">
                    opt_in={String(row.renderOptIn)} status={String(row.renderStatus)}
                  </span>
                </div>
                {row.renderedAt ? (
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Rendered at:</span>{" "}
                    {fmtDate(row.renderedAt)}
                  </div>
                ) : null}
                {row.renderImageUrl ? (
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Render image:</span>{" "}
                    <a
                      className="underline break-all"
                      href={row.renderImageUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open
                    </a>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
              <h2 className="font-semibold">Input (quote_logs.input)</h2>
              <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-100">
                {pretty(row.input)}
              </pre>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
              <h2 className="font-semibold">Output (quote_logs.output)</h2>
              <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-100">
                {pretty(row.output)}
              </pre>
            </section>

            {(row.renderPrompt || row.renderError) && (
              <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
                <h2 className="font-semibold">Render details</h2>

                {row.renderPrompt ? (
                  <>
                    <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">render_prompt</div>
                    <pre className="mt-2 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-100">
                      {String(row.renderPrompt)}
                    </pre>
                  </>
                ) : null}

                {row.renderError ? (
                  <>
                    <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">render_error</div>
                    <pre className="mt-2 overflow-auto rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                      {String(row.renderError)}
                    </pre>
                  </>
                ) : null}
              </section>
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}
