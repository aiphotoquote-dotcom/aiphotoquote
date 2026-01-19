import TopNav from "@/components/TopNav";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db/client";
import { quoteLogs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

type PageProps = {
  params: { id: string };
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function fmtDate(iso: string | Date | null | undefined) {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function money(n: unknown) {
  const x = typeof n === "number" ? n : n == null ? null : Number(n);
  if (x == null || Number.isNaN(x)) return "";
  return x.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
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

  return (
    <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", cls)}>
      {label}
    </span>
  );
}

function safeString(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function prettyJson(x: unknown) {
  try {
    return JSON.stringify(x ?? null, null, 2);
  } catch {
    return String(x ?? "");
  }
}

function renderStatusTone(s: string) {
  const x = s.toLowerCase();
  if (x === "rendered") return "green" as const;
  if (x === "failed") return "red" as const;
  if (x === "queued" || x === "running") return "blue" as const;
  if (x === "not_requested") return "gray" as const;
  return "gray" as const;
}

function renderStatusLabel(s: string, renderOptIn?: boolean | null) {
  const x = (s || "not_requested").toLowerCase();
  if (x === "rendered") return "Rendered";
  if (x === "failed") return "Render failed";
  if (x === "queued" || x === "running") return "Rendering";
  if (renderOptIn) return "Render requested";
  return "Estimate";
}

export default async function AdminQuoteDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.userId) redirect("/sign-in");

  const id = params?.id;
  if (!id) notFound();

  const rows = await db
    .select({
      id: quoteLogs.id,
      tenantId: quoteLogs.tenantId,
      input: quoteLogs.input,
      output: quoteLogs.output,
      createdAt: quoteLogs.createdAt,

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

  const row = rows[0];
  if (!row) notFound();

  const input: any = row.input ?? {};
  const output: any = row.output ?? {};

  const images: Array<{ url: string }> = Array.isArray(input?.images) ? input.images : [];
  const customerNotes =
    safeString(input?.customer_context?.notes) ||
    safeString(input?.customer_context?.note) ||
    safeString(input?.notes);

  const serviceType = safeString(input?.customer_context?.service_type);
  const category = safeString(input?.customer_context?.category) || safeString(output?.category);

  // common output shapes you've used:
  const assessment = output?.assessment ?? output;
  const summary =
    safeString(assessment?.summary) ||
    safeString(output?.summary) ||
    safeString(assessment?.visible_scope?.join?.("\n")) ||
    "";

  const estLow =
    assessment?.estimate_low ??
    output?.estimate_low ??
    assessment?.estimateLow ??
    output?.estimateLow ??
    null;

  const estHigh =
    assessment?.estimate_high ??
    output?.estimate_high ??
    assessment?.estimateHigh ??
    output?.estimateHigh ??
    null;

  const inspectionRequired =
    assessment?.inspection_required ??
    output?.inspection_required ??
    assessment?.inspectionRequired ??
    output?.inspectionRequired ??
    null;

  const renderStatus = safeString(row.renderStatus || "not_requested");

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <TopNav />

      <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <Link
                href="/admin/quotes"
                className="text-sm font-semibold text-gray-700 underline hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
              >
                ← Back to Quotes
              </Link>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Created {fmtDate(row.createdAt)}
              </span>
            </div>

            <h1 className="mt-2 text-2xl font-semibold">Quote Review</h1>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {pill(
                renderStatusLabel(renderStatus, row.renderOptIn),
                renderStatusTone(renderStatus)
              )}

              {typeof inspectionRequired === "boolean" && inspectionRequired
                ? pill("Inspection required", "yellow")
                : null}

              {category ? pill(category, "gray") : null}

              {(estLow != null || estHigh != null) && (
                <span className="text-sm text-gray-700 dark:text-gray-200">
                  Est:{" "}
                  <span className="font-semibold">
                    {money(estLow)}
                    {estHigh != null ? ` – ${money(estHigh)}` : ""}
                  </span>
                </span>
              )}
            </div>

            <div className="mt-3 font-mono text-xs text-gray-600 dark:text-gray-400 break-all">
              {row.id}
            </div>
          </div>

          {/* Primary actions */}
          <div className="flex flex-wrap items-center gap-3">
            {row.renderImageUrl ? (
              <a
                href={row.renderImageUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                View render
              </a>
            ) : null}

            <a
              href={`/admin/quotes/${row.id}`}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:hover:bg-gray-900"
            >
              Copy deep link
            </a>
          </div>
        </div>

        {/* 3-column focus layout */}
        <div className="grid gap-6 lg:grid-cols-12">
          {/* LEFT: submission */}
          <section
            id="submission"
            className="lg:col-span-4 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold">Submission</h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  What the customer sent you.
                </p>
              </div>

              <div className="text-xs text-gray-500 dark:text-gray-400">
                {images.length ? `${images.length} photo${images.length === 1 ? "" : "s"}` : "No photos"}
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {/* Notes */}
              <div>
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Notes
                </div>
                <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-200">
                  {customerNotes ? (
                    <div className="whitespace-pre-wrap">{customerNotes}</div>
                  ) : (
                    <span className="text-gray-500 dark:text-gray-500">—</span>
                  )}
                </div>

                {(serviceType || category) && (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {serviceType ? pill(`Service: ${serviceType}`, "gray") : null}
                    {category ? pill(`Category: ${category}`, "gray") : null}
                  </div>
                )}
              </div>

              {/* Photos */}
              <div>
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Photos
                </div>

                {images.length ? (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    {images.slice(0, 8).map((im, idx) => (
                      <a
                        key={`${im.url}-${idx}`}
                        href={im.url}
                        target="_blank"
                        rel="noreferrer"
                        className="group relative overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-black"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={im.url}
                          alt={`photo ${idx + 1}`}
                          className="h-40 w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 text-[11px] text-white">
                          Photo {idx + 1}
                        </div>
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-black dark:text-gray-300">
                    No images were attached.
                  </div>
                )}

                {images.length > 8 ? (
                  <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                    Showing 8 of {images.length}. Open any image to view full size.
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          {/* CENTER: AI output */}
          <section
            id="analysis"
            className="lg:col-span-5 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold">AI Result</h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  What the model produced (readable + raw).
                </p>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href="#raw"
                  className="text-xs font-semibold underline text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                >
                  Raw JSON
                </a>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {/* Summary */}
              <div>
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Summary
                </div>
                <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-200">
                  {summary ? (
                    <div className="whitespace-pre-wrap leading-relaxed">{summary}</div>
                  ) : (
                    <span className="text-gray-500 dark:text-gray-500">No summary field found.</span>
                  )}
                </div>
              </div>

              {/* Key fields */}
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-black">
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">Estimate</div>
                  <div className="mt-1 text-sm font-semibold">
                    {estLow != null || estHigh != null ? (
                      <>
                        {money(estLow)}
                        {estHigh != null ? ` – ${money(estHigh)}` : ""}
                      </>
                    ) : (
                      <span className="text-gray-500 dark:text-gray-500">—</span>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-black">
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">Inspection</div>
                  <div className="mt-1 text-sm font-semibold">
                    {typeof inspectionRequired === "boolean" ? (
                      inspectionRequired ? (
                        <span className="text-yellow-700 dark:text-yellow-200">Required</span>
                      ) : (
                        <span className="text-green-700 dark:text-green-200">Not required</span>
                      )
                    ) : (
                      <span className="text-gray-500 dark:text-gray-500">—</span>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-black">
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">Render</div>
                  <div className="mt-1 text-sm font-semibold">
                    {renderStatusLabel(renderStatus, row.renderOptIn)}
                  </div>
                </div>
              </div>

              {/* Raw JSON */}
              <div id="raw">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Raw output JSON
                </div>
                <pre className="mt-2 max-h-[520px] overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-200">
{prettyJson(output)}
                </pre>
              </div>
            </div>
          </section>

          {/* RIGHT: actions + render info */}
          <aside
            id="actions"
            className="lg:col-span-3 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950"
          >
            <div>
              <h2 className="font-semibold">Actions</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Quick jumps + status.
              </p>
            </div>

            <div className="mt-5 space-y-3">
              <a
                href="#submission"
                className="block rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:hover:bg-gray-900"
              >
                Jump to Submission
              </a>

              <a
                href="#analysis"
                className="block rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:hover:bg-gray-900"
              >
                Jump to AI Result
              </a>

              <a
                href="#raw"
                className="block rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:hover:bg-gray-900"
              >
                Jump to Raw JSON
              </a>
            </div>

            <div className="mt-6 border-t border-gray-200 pt-5 dark:border-gray-800">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Render status
                </div>
                {pill(renderStatusLabel(renderStatus, row.renderOptIn), renderStatusTone(renderStatus))}
              </div>

              <div className="mt-3 space-y-2 text-sm text-gray-800 dark:text-gray-200">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-gray-600 dark:text-gray-400">Opt-in</span>
                  <span className="font-semibold">{row.renderOptIn ? "Yes" : "No"}</span>
                </div>

                <div className="flex items-start justify-between gap-3">
                  <span className="text-gray-600 dark:text-gray-400">Rendered at</span>
                  <span className="text-right">{row.renderedAt ? fmtDate(row.renderedAt) : "—"}</span>
                </div>
              </div>

              {row.renderImageUrl ? (
                <div className="mt-4">
                  <a
                    href={row.renderImageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-xl bg-black px-4 py-3 text-center text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                  >
                    Open rendered image
                  </a>
                </div>
              ) : null}

              {row.renderPrompt ? (
                <div className="mt-4">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                    Render prompt
                  </div>
                  <pre className="mt-2 max-h-40 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-200 whitespace-pre-wrap">
{safeString(row.renderPrompt)}
                  </pre>
                </div>
              ) : null}

              {row.renderError ? (
                <div className="mt-4">
                  <div className="text-xs font-semibold text-red-700 dark:text-red-200">
                    Render error
                  </div>
                  <pre className="mt-2 max-h-40 overflow-auto rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200 whitespace-pre-wrap">
{safeString(row.renderError)}
                  </pre>
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
