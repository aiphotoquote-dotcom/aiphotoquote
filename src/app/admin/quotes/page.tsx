import { sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export default async function AdminQuotesPage() {
  // Keep it simple + tolerant: only rely on columns that exist in prod
  const r = await db.execute(sql`
    select id, tenant_id, input, output, created_at
    from quote_logs
    order by created_at desc
    limit 50
  `);

  const rows: any[] =
    (r as any)?.rows ?? (Array.isArray(r) ? (r as any) : []);

  const items = rows.map((row) => {
    const input = safeJsonParse(row.input) ?? {};
    const output = safeJsonParse(row.output) ?? {};

    const tenantSlug = input?.tenantSlug ?? "";
    const customer = input?.customer_context ?? {};
    const createdAt = row.created_at ? new Date(row.created_at).toLocaleString() : "";

    const assessment = output?.assessment ?? null;
    const summary =
      (typeof assessment?.summary === "string" && assessment.summary) ||
      (typeof output?.summary === "string" && output.summary) ||
      "";

    const email = output?.email ?? null;
    const leadSent = Boolean(email?.lead?.sent);

    return {
      id: row.id as string,
      tenant: tenantSlug || String(row.tenant_id || ""),
      customerName: String(customer?.name || ""),
      customerEmail: String(customer?.email || ""),
      createdAt,
      summary,
      leadSent,
    };
  });

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Quotes</h1>
          <p className="mt-1 text-sm text-gray-600">
            Latest 50 quote submissions.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="grid grid-cols-12 gap-2 border-b bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-700">
          <div className="col-span-3">Created</div>
          <div className="col-span-2">Tenant</div>
          <div className="col-span-3">Customer</div>
          <div className="col-span-3">Summary</div>
          <div className="col-span-1 text-right">Lead</div>
        </div>

        {items.length === 0 ? (
          <div className="px-4 py-8 text-sm text-gray-600">No quotes yet.</div>
        ) : (
          <div className="divide-y">
            {items.map((q) => (
              <Link
                key={q.id}
                href={`/admin/quotes/${q.id}`}
                className="block hover:bg-gray-50"
              >
                <div className="grid grid-cols-12 gap-2 px-4 py-3 text-sm">
                  <div className="col-span-3 text-gray-700">{q.createdAt}</div>

                  <div className="col-span-2">
                    <div className="text-gray-900">{q.tenant || "-"}</div>
                  </div>

                  <div className="col-span-3">
                    <div className="text-gray-900">{q.customerName || "-"}</div>
                    <div className="text-xs text-gray-600 font-mono break-all">
                      {q.customerEmail || ""}
                    </div>
                  </div>

                  <div className="col-span-3 text-gray-700 line-clamp-2">
                    {q.summary || <span className="text-gray-400">(no summary)</span>}
                  </div>

                  <div className="col-span-1 text-right">
                    <span
                      className={[
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                        q.leadSent ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800",
                      ].join(" ")}
                    >
                      {q.leadSent ? "SENT" : "—"}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
