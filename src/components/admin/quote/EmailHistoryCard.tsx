// src/components/admin/quote/EmailHistoryCard.tsx
"use client";

import React from "react";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function fmtWhen(v: unknown) {
  try {
    const d = v instanceof Date ? v : new Date(String(v));
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

export type EmailHistoryRow = {
  id: string;
  kind: string;
  toEmails: string[];
  subject: string | null;
  provider: string | null;
  providerMessageId: string | null;
  ok: boolean;
  error: string | null;
  createdAt: any;
};

export default function EmailHistoryCard(props: { quoteId: string; emails: EmailHistoryRow[] }) {
  const quoteId = safeTrim(props.quoteId);
  const emails = Array.isArray(props.emails) ? props.emails : [];

  function hrefForEmail(emailId: string) {
    const eid = safeTrim(emailId);
    if (!quoteId || !eid) return null;
    return `/admin/quotes/${encodeURIComponent(quoteId)}/emails/${encodeURIComponent(eid)}`;
  }

  function onRowClick(href: string | null) {
    if (!href) return;
    window.location.href = href;
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950/40">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">Sent emails</div>
          <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            Emails sent for this quote (composer + future system sends).
          </div>
        </div>

        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">
          {emails.length ? `${emails.length} total` : "None yet"}
        </div>
      </div>

      {emails.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="text-gray-600 dark:text-gray-300">
                <th className="whitespace-nowrap border-b border-gray-200 py-2 pr-3 dark:border-gray-800">When</th>
                <th className="whitespace-nowrap border-b border-gray-200 py-2 pr-3 dark:border-gray-800">Kind</th>
                <th className="border-b border-gray-200 py-2 pr-3 dark:border-gray-800">To</th>
                <th className="border-b border-gray-200 py-2 pr-3 dark:border-gray-800">Subject</th>
                <th className="whitespace-nowrap border-b border-gray-200 py-2 pr-3 dark:border-gray-800">Provider</th>
                <th className="whitespace-nowrap border-b border-gray-200 py-2 pr-3 dark:border-gray-800">Status</th>
              </tr>
            </thead>

            <tbody>
              {emails.map((e) => {
                const to = (Array.isArray(e.toEmails) ? e.toEmails : []).map(safeTrim).filter(Boolean).join(", ");
                const subject = safeTrim(e.subject) || "—";
                const kind = safeTrim(e.kind) || "—";
                const provider = safeTrim(e.provider) || "—";
                const ok = Boolean(e.ok);
                const err = safeTrim(e.error);

                const href = hrefForEmail(e.id);

                return (
                  <tr
                    key={e.id}
                    onClick={() => onRowClick(href)}
                    className={
                      "align-top " +
                      (href
                        ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900/20"
                        : "")
                    }
                    title={href ? "Click to view sent email" : undefined}
                  >
                    <td className="whitespace-nowrap border-b border-gray-100 py-2 pr-3 text-gray-600 dark:border-gray-900/60 dark:text-gray-400">
                      {fmtWhen(e.createdAt)}
                    </td>

                    <td className="whitespace-nowrap border-b border-gray-100 py-2 pr-3 dark:border-gray-900/60">
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-800 dark:bg-gray-900/40 dark:text-gray-200">
                        {kind}
                      </span>
                    </td>

                    <td className="border-b border-gray-100 py-2 pr-3 text-gray-900 dark:border-gray-900/60 dark:text-gray-100">
                      {to || "—"}
                    </td>

                    <td className="border-b border-gray-100 py-2 pr-3 text-gray-900 dark:border-gray-900/60 dark:text-gray-100">
                      {href ? (
                        <a
                          href={href}
                          className="font-extrabold text-gray-900 underline decoration-gray-300 underline-offset-2 hover:decoration-gray-700 dark:text-gray-100 dark:decoration-gray-700 dark:hover:decoration-gray-300"
                          title="View sent email"
                          onClick={(ev) => {
                            // prevent double nav (row click + link click)
                            ev.stopPropagation();
                          }}
                        >
                          {subject}
                        </a>
                      ) : (
                        subject
                      )}

                      {e.providerMessageId ? (
                        <div className="mt-1 font-mono text-[11px] text-gray-500 dark:text-gray-400">
                          msgId: {safeTrim(e.providerMessageId)}
                        </div>
                      ) : null}

                      {!ok && err ? (
                        <div className="mt-1 text-[11px] text-red-700 dark:text-red-300">{err}</div>
                      ) : null}

                      {href ? (
                        <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Click to view</div>
                      ) : null}
                    </td>

                    <td className="whitespace-nowrap border-b border-gray-100 py-2 pr-3 text-gray-700 dark:border-gray-900/60 dark:text-gray-300">
                      {provider}
                    </td>

                    <td className="whitespace-nowrap border-b border-gray-100 py-2 pr-3 dark:border-gray-900/60">
                      <span
                        className={
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold " +
                          (ok
                            ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"
                            : "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200")
                        }
                      >
                        {ok ? "sent" : "failed"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-gray-200 p-4 text-xs text-gray-600 dark:border-gray-800 dark:text-gray-400">
          No emails have been sent for this quote yet.
        </div>
      )}
    </div>
  );
}