import { sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

function safeJsonParse(v: any) {
  try {
    if (v == null) return null;
    if (typeof v === "object") return v;
    if (typeof v === "string") return JSON.parse(v);
    return v;
  } catch {
    return null;
  }
}

function Badge({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        ok
          ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200"
          : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
      ].join(" ")}
    >
      {text}
    </span>
  );
}

function Pill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "green" | "yellow" | "red" | "blue";
}) {
  const cls =
    tone === "green"
      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200"
      : tone === "yellow"
        ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200"
        : tone === "red"
          ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
          : tone === "blue"
            ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
            : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100";

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function pickAssessment(output: any) {
  if (!output || typeof output !== "object") return null;

  if (output.assessment && typeof output.assessment === "object") return output.assessment;
  if (output.output && typeof output.output === "object") return output.output;

  const looksLikeAssessment =
    typeof output.confidence === "string" ||
    typeof output.summary === "string" ||
    typeof output.inspection_required === "boolean" ||
    Array.isArray(output.questions);

  if (looksLikeAssessment) return output;

  return null;
}

function titleCase(s: string) {
  const v = String(s || "").trim();
  if (!v) return "";
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function asArray(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  return [];
}

export default async function AdminQuoteDetailPage(props: PageProps) {
  const { id } = await props.params;

  let row: any = null;
  let renderingColumnsAvailable = true;

  try {
    const rNew = await db.execute(sql`
      select
        id,
        tenant_id,
        input,
        output,
        created_at,
        render_opt_in,
        render_status,
        render_image_url,
        render_prompt,
        render_error,
        rendered_at
      from quote_logs
      where id = ${id}::uuid
      limit 1
    `);

    row =
      (rNew as any)?.rows?.[0] ??
      (Array.isArray(rNew) ? (rNew as any)[0] : null);
  } catch {
    renderingColumnsAvailable = false;

    const rOld = await db.execute(sql`
      select id, tenant_id, input, output, created_at
      from quote_logs
      where id = ${id}::uuid
      limit 1
    `);

    row =
      (rOld as any)?.rows?.[0] ??
      (Array.isArray(rOld) ? (rOld as any)[0] : null);
  }

  if (!row) notFound();

  const input = safeJsonParse(row.input) ?? {};
  const output = safeJsonParse(row.output) ?? {};

  const assessment = pickAssessment(output);
  const email = output?.email ?? null;

  const lead = email?.lead ?? null;
  const customer = email?.customer ?? null;

  const tenantSlug = input?.tenantSlug ?? "";
  const images: string[] = (input?.images ?? []).map((x: any) => x?.url).filter(Boolean);

  const customerCtx = input?.customer_context ?? {};
  const createdAt = row.created_at ? new Date(row.created_at).toLocaleString() : "";

  const leadConfigured = Boolean(email?.configured);
  const leadSent = Boolean(lead?.sent);
  const customerAttempted = Boolean(customer?.attempted);
  const customerSent = Boolean(customer?.sent);

  // Rendering (DB columns preferred; fallback to output.rendering)
  const outputRendering = output?.rendering ?? null;

  const renderOptIn =
    (renderingColumnsAvailable && row.render_opt_in === true) || outputRendering?.requested === true
      ? true
      : false;

  const renderStatus =
    (renderingColumnsAvailable ? (row.render_status as string | null) : null) ??
    (outputRendering?.status as string | null) ??
    "not_requested";

  const renderImageUrl =
    (renderingColumnsAvailable ? (row.render_image_url as string | null) : null) ??
    (outputRendering?.imageUrl as string | null) ??
    null;

  const renderPrompt =
    (renderingColumnsAvailable ? (row.render_prompt as string | null) : null) ?? null;

  const renderError =
    (renderingColumnsAvailable ? (row.render_error as string | null) : null) ??
    (outputRendering?.error as string | null) ??
    null;

  const renderedAt =
    renderingColumnsAvailable && row.rendered_at ? new Date(row.rendered_at).toLocaleString() : "";

  // Assessment fields (normalized)
  const a = assessment ?? null;
  const summary = a?.summary ? String(a.summary) : "";
  const confidence = a?.confidence ? String(a.confidence) : "";
  const inspectionRequired = a?.inspection_required === true;

  const questions = asArray(a?.questions);
  const visibleScope = asArray(a?.visible_scope);
  const assumptions = asArray(a?.assumptions);

  const confidenceTone =
    confidence === "high" ? "green" : confidence === "medium" ? "yellow" : confidence === "low" ? "red" : "neutral";

  const statusTone =
    renderStatus === "rendered"
      ? "green"
      : renderStatus === "queued"
        ? "yellow"
        : renderStatus === "failed"
          ? "red"
          : "neutral";

  const pageBg = "bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100";
  const card = "rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900";
  const innerCard = "rounded-xl border border-gray-200 p-4 dark:border-gray-800";
  const muted = "text-sm text-gray-600 dark:text-gray-300";
  const mono = "font-mono text-gray-900 dark:text-gray-100";
  const link = "text-blue-700 hover:underline dark:text-blue-300";
  const pre = "overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-gray-950";

  return (
    <div className={`${pageBg} min-h-screen`}>
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Quote Detail</h1>
            <p className={`mt-1 ${muted}`}>
              <span className={mono}>{row.id}</span>
            </p>
            <p className={`mt-1 ${muted}`}>
              Tenant: <span className="font-medium">{tenantSlug || row.tenant_id}</span>
              {createdAt ? (
                <>
                  {" "}
                  · Created: <span className="font-medium">{createdAt}</span>
                </>
              ) : null}
            </p>
          </div>

          <div className="flex gap-2">
            <a
              href="/admin/quotes"
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
            >
              ← Back to Quotes
            </a>
          </div>
        </div>

        {/* Email Status */}
        <div className={`mb-6 ${card}`}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Email Status</h2>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {leadConfigured ? "Resend configured" : "Resend not configured (or missing env vars)"}
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className={innerCard}>
              <div className="flex items-center justify-between">
                <div className="font-medium">Lead Email (shop)</div>
                <Badge ok={leadSent} text={leadSent ? "SENT" : "NOT SENT"} />
              </div>
              <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">
                {lead?.id ? (
                  <div>
                    Message ID: <span className={mono}>{lead.id}</span>
                  </div>
                ) : null}
                {lead?.error ? (
                  <div className="mt-2 rounded-lg bg-red-50 p-2 text-red-800 dark:bg-red-900/30 dark:text-red-200">
                    Error: <span className={mono}>{String(lead.error)}</span>
                  </div>
                ) : null}
                {!lead?.attempted && leadConfigured ? (
                  <div className="mt-2 text-gray-600 dark:text-gray-300">Not attempted.</div>
                ) : null}
                {!leadConfigured ? (
                  <div className="mt-2 text-gray-600 dark:text-gray-300">
                    Set <span className={mono}>RESEND_API_KEY</span>,{" "}
                    <span className={mono}>RESEND_FROM_EMAIL</span>,{" "}
                    <span className={mono}>LEAD_TO_EMAIL</span>.
                  </div>
                ) : null}
              </div>
            </div>

            <div className={innerCard}>
              <div className="flex items-center justify-between">
                <div className="font-medium">Customer Receipt</div>
                <Badge ok={customerSent} text={customerSent ? "SENT" : customerAttempted ? "FAILED" : "SKIPPED"} />
              </div>

              <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">
                <div>
                  Customer email: <span className={mono}>{customerCtx?.email || "(not provided)"}</span>
                </div>

                {customer?.id ? (
                  <div className="mt-2">
                    Message ID: <span className={mono}>{customer.id}</span>
                  </div>
                ) : null}

                {customer?.error ? (
                  <div className="mt-2 rounded-lg bg-red-50 p-2 text-red-800 dark:bg-red-900/30 dark:text-red-200">
                    Error: <span className={mono}>{String(customer.error)}</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {/* AI Rendering */}
        <div className={`mb-6 ${card}`}>
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">AI Rendering</h2>
            <div className="flex items-center gap-2">
              <Pill
                label={renderStatus === "not_requested" ? "NOT REQUESTED" : titleCase(renderStatus)}
                tone={statusTone}
              />
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Opt-in: <span className="font-medium">{renderOptIn ? "yes" : "no"}</span>
                {renderedAt ? (
                  <>
                    {" "}
                    · Rendered: <span className="font-medium">{renderedAt}</span>
                  </>
                ) : null}
              </span>
            </div>
          </div>

          {!renderingColumnsAvailable ? (
            <div className="mb-4 rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-900/20 dark:text-yellow-200">
              Rendering columns are not available in the database yet.
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div className={innerCard}>
              <div className="text-sm font-medium">Details</div>
              <div className="mt-2 text-sm text-gray-700 dark:text-gray-200 space-y-2">
                <div>
                  Status: <span className={mono}>{String(renderStatus)}</span>
                </div>
                <div>
                  Requested (customer opt-in): <span className={mono}>{renderOptIn ? "true" : "false"}</span>
                </div>

                {renderImageUrl ? (
                  <div>
                    Image URL:{" "}
                    <a className={`${link} break-all`} href={renderImageUrl} target="_blank" rel="noreferrer">
                      {renderImageUrl}
                    </a>
                  </div>
                ) : (
                  <div className="text-gray-600 dark:text-gray-300">(no image stored)</div>
                )}

                {renderError ? (
                  <div className="mt-2 rounded-lg bg-red-50 p-2 text-red-800 dark:bg-red-900/30 dark:text-red-200">
                    Error: <span className={mono}>{String(renderError)}</span>
                  </div>
                ) : null}
              </div>
            </div>

            <div className={innerCard}>
              <div className="text-sm font-medium">Preview</div>
              <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">
                {renderImageUrl ? (
                  <a
                    href={renderImageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={renderImageUrl}
                      alt="AI concept rendering"
                      className="h-64 w-full object-contain bg-gray-50 dark:bg-gray-950"
                    />
                  </a>
                ) : (
                  <div className="text-gray-600 dark:text-gray-300">(no preview)</div>
                )}
              </div>
            </div>
          </div>

          {renderPrompt ? (
            <div className="mt-4">
              <div className="text-sm font-medium">Prompt</div>
              <pre className="mt-2 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs dark:border-gray-800 dark:bg-gray-950">
                {String(renderPrompt)}
              </pre>
            </div>
          ) : null}
        </div>

        {/* Request */}
        <div className={`mb-6 ${card}`}>
          <h2 className="text-lg font-semibold">Request</h2>

          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div className={innerCard}>
              <div className="text-sm font-medium">Customer Context</div>
              <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">
                <div>
                  Category: <span className={mono}>{customerCtx?.category ?? ""}</span>
                </div>
                <div>
                  Service: <span className={mono}>{customerCtx?.service_type ?? ""}</span>
                </div>
                <div>
                  Notes:{" "}
                  <span className={`whitespace-pre-wrap ${mono}`}>
                    {customerCtx?.notes ?? ""}
                  </span>
                </div>
              </div>
            </div>

            <div className={innerCard}>
              <div className="text-sm font-medium">Images</div>
              <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">
                {images.length ? (
                  <ul className="list-disc pl-5">
                    {images.map((u) => (
                      <li key={u} className="break-all">
                        <a className={link} href={u} target="_blank" rel="noreferrer">
                          {u}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-gray-600 dark:text-gray-300">(none)</div>
                )}
              </div>
            </div>
          </div>

          {images.length ? (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {images.slice(0, 9).map((u) => (
                <a
                  key={u}
                  href={u}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="uploaded" className="h-48 w-full object-cover" />
                </a>
              ))}
            </div>
          ) : null}
        </div>

        {/* Assessment (pretty) */}
        <div className={`mb-6 ${card}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Assessment</h2>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Human-friendly view. Raw JSON is available below for debugging.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Pill label={confidence ? `Confidence: ${titleCase(confidence)}` : "Confidence: —"} tone={confidenceTone} />
              <Pill
                label={inspectionRequired ? "Inspection required" : "Inspection not required"}
                tone={inspectionRequired ? "yellow" : "green"}
              />
            </div>
          </div>

          {!a ? (
            <div className="mt-4 text-sm text-gray-600 dark:text-gray-300">(no assessment stored)</div>
          ) : (
            <div className="mt-4 space-y-5">
              <div className={innerCard}>
                <div className="text-sm font-semibold">Summary</div>
                <div className="mt-2 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                  {summary || <span className="text-gray-500 dark:text-gray-400">(no summary)</span>}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className={innerCard}>
                  <div className="text-sm font-semibold">Visible scope</div>
                  {visibleScope.length ? (
                    <ul className="mt-2 list-disc pl-5 text-sm text-gray-800 dark:text-gray-200 space-y-1">
                      {visibleScope.slice(0, 12).map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">(none listed)</div>
                  )}
                </div>

                <div className={innerCard}>
                  <div className="text-sm font-semibold">Assumptions</div>
                  {assumptions.length ? (
                    <ul className="mt-2 list-disc pl-5 text-sm text-gray-800 dark:text-gray-200 space-y-1">
                      {assumptions.slice(0, 12).map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">(none listed)</div>
                  )}
                </div>
              </div>

              <div className={innerCard}>
                <div className="flex items-center justify-between gap-4">
                  <div className="text-sm font-semibold">Questions to confirm</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {questions.length ? `${questions.length} item(s)` : "0"}
                  </div>
                </div>

                {questions.length ? (
                  <ul className="mt-2 list-disc pl-5 text-sm text-gray-800 dark:text-gray-200 space-y-1">
                    {questions.slice(0, 12).map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">(none)</div>
                )}
              </div>
            </div>
          )}

          <details className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
            <summary className="cursor-pointer text-sm font-semibold">
              Raw assessment JSON (debug)
            </summary>
            <pre className={`${pre} mt-3 text-xs`}>{JSON.stringify(a ?? null, null, 2)}</pre>
          </details>
        </div>

        {/* Raw output (debug) */}
        <div className={card}>
          <h2 className="text-lg font-semibold">Raw quote_logs.output</h2>
          <details className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
            <summary className="cursor-pointer text-sm font-semibold">
              Expand raw output JSON (debug)
            </summary>
            <pre className={`${pre} mt-3 text-xs`}>{JSON.stringify(output, null, 2)}</pre>
          </details>
        </div>
      </div>
    </div>
  );
}
