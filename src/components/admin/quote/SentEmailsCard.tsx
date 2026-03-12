// src/components/admin/quote/SentEmailsCard.tsx
import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function fmtTs(v: any) {
  try {
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

function asStringArray(v: any): string[] {
  try {
    if (!v) return [];
    if (Array.isArray(v)) return v.map((x) => safeTrim(x)).filter(Boolean);
    if (typeof v === "string") {
      const s = v.trim();
      if (!s) return [];
      // might be JSON
      if (s.startsWith("[") && s.endsWith("]")) {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return parsed.map((x) => safeTrim(x)).filter(Boolean);
      }
      return [s];
    }
    // might already be jsonb object
    if (typeof v === "object" && Array.isArray((v as any))) return (v as any).map((x: any) => safeTrim(x)).filter(Boolean);
    return [];
  } catch {
    return [];
  }
}

export default async function SentEmailsCard(props: { tenantId: string; quoteId: string }) {
  const tenantId = safeTrim(props.tenantId);
  const quoteId = safeTrim(props.quoteId);

  const r = await db.execute(sql`
    select
      id::text as id,
      ok,
      provider,
      provider_message_id,
      from_email,
      to_emails,
      subject,
      left(coalesce(error,''), 240) as error_240,
      created_at
    from quote_email_logs
    where tenant_id = ${tenantId}::uuid
      and quote_log_id = ${quoteId}::uuid
    order by created_at desc
    limit 50
  `);

  const rows: any[] = (r as any)?.rows ?? (Array.isArray(r) ? (r as any) : []);
  const hasAny = rows.length > 0;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950/40">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">Sent emails</div>
          <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            History of emails sent from the Email Builder / Composer.
          </div>
        </div>

        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">{hasAny ? `${rows.length}` : "0"}</div>
      </div>

      {!hasAny ? (
        <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900/30 dark:text-gray-300">
          No emails sent yet for this quote.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((x) => {
            const ok = Boolean(x.ok);
            const provider = safeTrim(x.provider) || "—";
            const providerId = safeTrim(x.provider_message_id);
            const fromEmail = safeTrim(x.from_email);
            const toEmails = asStringArray(x.to_emails);
            const subject = safeTrim(x.subject) || "(no subject)";
            const err = safeTrim(x.error_240);

            return (
              <div
                key={String(x.id)}
                className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950/20"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-extrabold " +
                        (ok
                          ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"
                          : "bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-200")
                      }
                    >
                      {ok ? "SENT" : "FAILED"}
                    </span>

                    <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">{fmtTs(x.created_at)}</div>
                  </div>

                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {provider}
                    {providerId ? <span className="ml-2 font-mono">#{providerId.slice(0, 12)}</span> : null}
                  </div>
                </div>

                <div className="mt-2 text-sm font-bold text-gray-900 dark:text-gray-100">{subject}</div>

                <div className="mt-2 grid gap-1 text-xs text-gray-600 dark:text-gray-400">
                  <div>
                    <span className="font-semibold">From:</span> {fromEmail || "—"}
                  </div>
                  <div>
                    <span className="font-semibold">To:</span> {toEmails.length ? toEmails.join(", ") : "—"}
                  </div>
                </div>

                {!ok && err ? (
                  <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
                    {err}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}