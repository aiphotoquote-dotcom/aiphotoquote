// src/app/admin/quotes/[id]/emails/[emailId]/page.tsx
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { resolveActiveTenantId } from "@/lib/admin/quotes/getActiveTenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function safeJson(v: unknown): any {
  if (v == null) return null;
  if (typeof v === "object") return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }
  return null;
}

function asEmailList(v: unknown): string[] {
  const j = safeJson(v);
  if (Array.isArray(j)) return j.map((x) => safeTrim(x)).filter(Boolean);
  if (typeof j === "string") return j.split(",").map((x) => safeTrim(x)).filter(Boolean);
  return [];
}

// basic safety hardening for preview (iframe is sandboxed anyway)
function stripDangerous(html: string) {
  const s = String(html ?? "");
  // remove script tags
  const noScripts = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  // remove on* handlers (onclick=, onload=, etc.)
  const noHandlers = noScripts.replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "");
  return noHandlers;
}

export default async function QuoteEmailViewPage(props: {
  params: Promise<{ id: string; emailId: string }> | { id: string; emailId: string };
}) {
  const session = await auth();
  const userId = session.userId;
  if (!userId) redirect("/sign-in");

  const p = await props.params;
  const quoteId = safeTrim((p as any)?.id);
  const emailId = safeTrim((p as any)?.emailId);

  if (!quoteId) redirect("/admin/quotes");
  if (!emailId) redirect(`/admin/quotes/${encodeURIComponent(quoteId)}`);

  const jar = await cookies();
  const tenantIdMaybe = await resolveActiveTenantId({ jar, userId });
  if (!tenantIdMaybe) redirect("/admin/quotes");
  const tenantId = String(tenantIdMaybe);

  const r = await db.execute(sql`
    select
      id,
      tenant_id,
      quote_log_id,
      kind,
      initiated_by,
      provider,
      provider_message_id,
      from_email,
      to_json,
      cc_json,
      bcc_json,
      subject,
      html,
      text,
      meta,
      created_at
    from quote_emails
    where id = ${emailId}::uuid
      and tenant_id = ${tenantId}::uuid
      and quote_log_id = ${quoteId}::uuid
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

  if (!row) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <a
          href={`/admin/quotes/${encodeURIComponent(quoteId)}`}
          className="text-sm font-semibold text-gray-600 hover:underline dark:text-gray-300"
        >
          ← Back to quote
        </a>

        <div className="mt-6 rounded-2xl border border-yellow-200 bg-yellow-50 p-6 text-sm text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
          <div className="text-base font-semibold">Email not found for this quote</div>
          <div className="mt-2">
            It may belong to a different tenant, or it may have been deleted.
          </div>
          <div className="mt-3 font-mono text-xs opacity-80">emailId={emailId}</div>
        </div>
      </div>
    );
  }

  const subject = safeTrim(row.subject) || "—";
  const kind = safeTrim(row.kind) || "unknown";
  const initiatedBy = safeTrim(row.initiated_by) || "system";

  const provider = safeTrim(row.provider) || "—";
  const providerMessageId = safeTrim(row.provider_message_id) || "";

  const fromEmail = safeTrim(row.from_email) || "—";
  const to = asEmailList(row.to_json);
  const cc = asEmailList(row.cc_json);
  const bcc = asEmailList(row.bcc_json);

  const createdAt = row.created_at ? new Date(row.created_at).toLocaleString() : "—";

  const htmlRaw = safeTrim(row.html);
  const textRaw = safeTrim(row.text);

  const previewHtml = htmlRaw ? stripDangerous(htmlRaw) : "";

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <a
          href={`/admin/quotes/${encodeURIComponent(quoteId)}`}
          className="text-sm font-semibold text-gray-600 hover:underline dark:text-gray-300"
        >
          ← Back to quote
        </a>

        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-extrabold text-gray-900 dark:bg-gray-900/40 dark:text-gray-100">
            Kind: {kind}
          </span>
          <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-extrabold text-gray-900 dark:bg-gray-900/40 dark:text-gray-100">
            Initiated: {initiatedBy}
          </span>
          <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-extrabold text-gray-900 dark:bg-gray-900/40 dark:text-gray-100">
            Provider: {provider}
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950/40">
        <div className="text-lg font-extrabold text-gray-900 dark:text-gray-100">{subject}</div>
        <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">Sent: {createdAt}</div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">From</div>
            <div className="mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{fromEmail}</div>

            <div className="mt-4 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">To</div>
            <div className="mt-2 text-sm text-gray-900 dark:text-gray-100">
              {to.length ? to.join(", ") : "—"}
            </div>

            {cc.length ? (
              <>
                <div className="mt-4 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">CC</div>
                <div className="mt-2 text-sm text-gray-900 dark:text-gray-100">{cc.join(", ")}</div>
              </>
            ) : null}

            {bcc.length ? (
              <>
                <div className="mt-4 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">BCC</div>
                <div className="mt-2 text-sm text-gray-900 dark:text-gray-100">{bcc.join(", ")}</div>
              </>
            ) : null}
          </div>

          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Provider</div>
            <div className="mt-2 text-sm text-gray-900 dark:text-gray-100">{provider}</div>

            {providerMessageId ? (
              <>
                <div className="mt-4 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Provider msgId
                </div>
                <div className="mt-2 font-mono text-xs text-gray-700 dark:text-gray-300 break-all">
                  {providerMessageId}
                </div>
              </>
            ) : null}

            <details className="mt-4">
              <summary className="cursor-pointer select-none text-sm font-semibold text-gray-700 dark:text-gray-200">
                Meta (debug)
              </summary>
              <pre className="mt-3 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-800 dark:bg-gray-950/30 dark:text-gray-100">
{JSON.stringify(safeJson(row.meta) ?? row.meta ?? {}, null, 2)}
              </pre>
            </details>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950/40">
        <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">Email preview</div>
        <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
          This is read-only. Scripts are blocked.
        </div>

        {previewHtml ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
            <iframe
              title="Email preview"
              className="h-[820px] w-full bg-white"
              // sandbox blocks scripts; we do NOT allow-scripts
              sandbox=""
              srcDoc={previewHtml}
            />
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-950/30 dark:text-gray-200">
            No HTML was stored for this email.
          </div>
        )}

        <details className="mt-4">
          <summary className="cursor-pointer select-none text-sm font-semibold text-gray-700 dark:text-gray-200">
            Raw HTML
          </summary>
          <pre className="mt-3 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-800 dark:bg-gray-950/30 dark:text-gray-100">
{htmlRaw || "—"}
          </pre>
        </details>

        <details className="mt-4">
          <summary className="cursor-pointer select-none text-sm font-semibold text-gray-700 dark:text-gray-200">
            Plain text
          </summary>
          <pre className="mt-3 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-800 dark:bg-gray-950/30 dark:text-gray-100">
{textRaw || "—"}
          </pre>
        </details>
      </div>
    </div>
  );
}