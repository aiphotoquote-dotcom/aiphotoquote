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

function Badge({
  ok,
  text,
}: {
  ok: boolean;
  text: string;
}) {
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

export default async function AdminQuoteDetailPage(props: PageProps) {
  const { id } = await props.params;

  // Fetch using raw SQL so we don't depend on Drizzle table field names
  const r = await db.execute(sql`
    select id, tenant_id, input, output, created_at
    from quote_logs
    where id = ${id}::uuid
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
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
            {createdAt ? <> · Created: <span className="font-medium">{createdAt}</span></> : null}
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
                text={
                  customerSent
                    ? "SENT"
                    : customerAttempted
                      ? "FAILED"
                      : "SKIPPED"
                }
              />
            </div>

            <div className="mt-2 text-sm text-gray-700">
              <div>
                Customer email:{" "}
                <span className="font-mono">
                  {customerCtx?.email || "(not provided)"}
                </span>
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
                <span className="whitespace-pre-wrap font-mono">
                  {customerCtx?.notes ?? ""}
                </span>
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
