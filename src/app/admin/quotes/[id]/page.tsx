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
        ok ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800",
      ].join(" ")}
    >
      {text}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const s = String(status || "").toLowerCase();

  const cls =
    s === "rendered"
      ? "bg-green-100 text-green-800"
      : s === "queued"
        ? "bg-yellow-100 text-yellow-800"
        : s === "failed"
          ? "bg-red-100 text-red-800"
          : "bg-gray-100 text-gray-800";

  const label =
    s === "rendered"
      ? "RENDERED"
      : s === "queued"
        ? "QUEUED"
        : s === "failed"
          ? "FAILED"
          : "NOT REQUESTED";

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

export default async function AdminQuoteDetailPage(props: PageProps) {
  const { id } = await props.params;

  let row: any = null;
  let renderingColumnsAvailable = true;

  // Try the "new columns" query first; fallback if columns aren't migrated yet.
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
  } catch (e: any) {
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

  const assessment = output?.assessment ?? null;
  const email = output?.email ?? null;

  const lead = email?.lead ?? null;
  const customer = email?.customer ?? null;

  const tenantSlug = input?.tenantSlug ?? "";
  const images: string[] = (input?.images ?? [])
    .map((x: any) => x?.url)
    .filter(Boolean);

  const customerCtx = input?.customer_context ?? {};
  const createdAt = row.created_at ? new Date(row.created_at).toLocaleString() : "";

  const leadConfigured = Boolean(email?.configured);
  const leadSent = Boolean(lead?.sent);
  const customerAttempted = Boolean(customer?.attempted);
  const customerSent = Boolean(customer?.sent);

  // Rendering: prefer DB columns (if present), fallback to output.rendering
  const outputRendering = output?.rendering ?? null;

  const renderOptIn =
    (renderingColumnsAvailable && row.render_opt_in === true) ||
    outputRendering?.requested === true
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
    renderingColumnsAvailable && row.rendered_at
      ? new Date(row.rendered_at).toLocaleString()
      : "";

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Quote Detail</h1>
          <p className="mt-1 text-sm text-gray-600">
            <span className="font-mono">{row.id}</span>
          </p>
          <p className="mt-1 text-sm text-gray-600">
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
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
          >
            ← Back to Quotes
          </a>
        </div>
      </div>

      {/* Email Status */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Email Status</h2>
          <span className="text-xs text-gray-500">
            {leadConfigured ? "Resend configured" : "Resend not configured (or missing env vars)"}
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div className="font-medium">Lead Email (shop)</div>
              <Badge ok={leadSent} text={leadSent ? "SENT" : "NOT SENT"} />
            </div>
            <div className="mt-2 text-sm text-gray-700">
              {lead?.id ? (
                <div>
                  Message ID: <span className="font-mono">{lead.id}</span>
                </div>
              ) : null}
              {lead?.error ? (
                <div className="mt-2 rounded-lg bg-red-50 p-2 text-red-800">
                  Error: <span className="font-mono">{String(lead.error)}</span>
                </div>
              ) : null}
              {!lead?.attempted && leadConfigured ? (
                <div className="mt-2 text-gray-600">Not attempted.</div>
              ) : null}
              {!leadConfigured ? (
                <div className="mt-2 text-gray-600">
                  Set <span className="font-mono">RESEND_API_KEY</span>,{" "}
                  <span className="font-mono">RESEND_FROM_EMAIL</span>,{" "}
                  <span className="font-mono">LEAD_TO_EMAIL</span>.
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div className="font-medium">Customer Receipt</div>
              <Badge
                ok={customerSent}
                text={customerSent ? "SENT" : customerAttempted ? "FAILED" : "SKIPPED"}
              />
            </div>

            <div className="mt-2 text-sm text-gray-700">
              <div>
                Customer email:{" "}
                <span className="font-mono">{customerCtx?.email || "(not provided)"}</span>
              </div>

              {customer?.id ? (
                <div className="mt-2">
                  Message ID: <span className="font-mono">{customer.id}</span>
                </div>
              ) : null}

              {customer?.error ? (
                <div className="mt-2 rounded-lg bg-red-50 p-2 text-red-800">
                  Error: <span className="font-mono">{String(customer.error)}</span>
                </div>
              ) : null}

              {!customerAttempted && (customerCtx?.email ? true : false) && leadConfigured ? (
                <div className="mt-2 text-gray-600">Not attempted.</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* AI Rendering */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">AI Rendering</h2>
          <div className="flex items-center gap-2">
            <StatusPill status={renderStatus} />
            <span className="text-xs text-gray-500">
              Opt-in: <span className="font-medium">{renderOptIn ? "yes" : "no"}</span>
              {renderedAt ? <> · Rendered: <span className="font-medium">{renderedAt}</span></> : null}
            </span>
          </div>
        </div>

        {!renderingColumnsAvailable ? (
          <div className="mb-4 rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900">
            Rendering columns are not available in the database yet. Run the migration to add the
            <span className="font-mono"> render_*</span> columns to <span className="font-mono">quote_logs</span>.
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-gray-200 p-4">
            <div className="text-sm font-medium text-gray-900">Details</div>
            <div className="mt-2 text-sm text-gray-700 space-y-2">
              <div>
                Status: <span className="font-mono">{String(renderStatus)}</span>
              </div>
              <div>
                Requested (customer opt-in):{" "}
                <span className="font-mono">{renderOptIn ? "true" : "false"}</span>
              </div>

              {renderImageUrl ? (
                <div>
                  Image URL:{" "}
                  <a className="break-all text-blue-700 hover:underline" href={renderImageUrl} target="_blank">
                    {renderImageUrl}
                  </a>
                </div>
              ) : (
                <div className="text-gray-600">(no image stored)</div>
              )}

              {renderError ? (
                <div className="mt-2 rounded-lg bg-red-50 p-2 text-red-800">
                  Error: <span className="font-mono">{String(renderError)}</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 p-4">
            <div className="text-sm font-medium text-gray-900">Preview</div>
            <div className="mt-2 text-sm text-gray-700">
              {renderImageUrl ? (
                <a href={renderImageUrl} target="_blank" className="block overflow-hidden rounded-xl border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={renderImageUrl}
                    alt="AI concept rendering"
                    className="h-64 w-full object-contain bg-gray-50"
                  />
                </a>
              ) : (
                <div className="text-gray-600">(no preview)</div>
              )}
            </div>
          </div>
        </div>

        {renderPrompt ? (
          <div className="mt-4">
            <div className="text-sm font-medium text-gray-900">Prompt</div>
            <pre className="mt-2 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs">
              {String(renderPrompt)}
            </pre>
          </div>
        ) : null}
      </div>

      {/* Request */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Request</h2>

        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-gray-200 p-4">
            <div className="text-sm font-medium text-gray-900">Customer Context</div>
            <div className="mt-2 text-sm text-gray-700">
              <div>
                Category: <span className="font-mono">{customerCtx?.category ?? ""}</span>
              </div>
              <div>
                Service: <span className="font-mono">{customerCtx?.service_type ?? ""}</span>
              </div>
              <div>
                Notes:{" "}
                <span className="whitespace-pre-wrap font-mono">{customerCtx?.notes ?? ""}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 p-4">
            <div className="text-sm font-medium text-gray-900">Images</div>
            <div className="mt-2 text-sm text-gray-700">
              {images.length ? (
                <ul className="list-disc pl-5">
                  {images.map((u) => (
                    <li key={u} className="break-all">
                      <a className="text-blue-700 hover:underline" href={u} target="_blank">
                        {u}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-gray-600">(none)</div>
              )}
            </div>
          </div>
        </div>

        {images.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {images.slice(0, 9).map((u) => (
              <a key={u} href={u} target="_blank" className="block overflow-hidden rounded-xl border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="uploaded" className="h-48 w-full object-cover" />
              </a>
            ))}
          </div>
        ) : null}
      </div>

      {/* Assessment */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Assessment</h2>
        {assessment ? (
          <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
            {JSON.stringify(assessment, null, 2)}
          </pre>
        ) : (
          <div className="mt-3 text-sm text-gray-600">(no assessment stored)</div>
        )}
      </div>
    </div>
  );
}
