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

function fmtWhen(v: unknown) {
  try {
    const d = v instanceof Date ? v : new Date(String(v));
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

// basic safety hardening for preview (iframe is sandboxed anyway)
function stripDangerous(html: string) {
  const s = String(html ?? "");
  const noScripts = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  const noHandlers = noScripts.replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "");
  return noHandlers;
}

type EmailRow = {
  id: string;
  tenant_id: string;
  quote_log_id: string;

  kind: string | null;
  initiated_by: string | null;

  provider: string | null;
  provider_message_id: string | null;

  // recipients
  to_emails?: any; // array (preferred)
  to_json?: any; // legacy alt
  cc_emails?: any;
  cc_json?: any;
  bcc_emails?: any;
  bcc_json?: any;

  // content
  from_email?: any;
  from?: any;
  subject?: any;

  html?: any;
  text?: any;

  // status
  ok?: any;
  error?: any;

  meta?: any;
  created_at?: any;
};

async function fetchEmailRow(args: { tenantId: string; quoteId: string; emailId: string }): Promise<EmailRow | null> {
  // 1) Try “rich” schema (has html/text/from/etc.)
  try {
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
        to_emails,
        cc_emails,
        bcc_emails,
        subject,
        html,
        text,
        meta,
        ok,
        error,
        created_at
      from quote_email_sends
      where id = ${args.emailId}::uuid
        and tenant_id = ${args.tenantId}::uuid
        and quote_log_id = ${args.quoteId}::uuid
      limit 1
    `);

    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
    return row ? (row as EmailRow) : null;
  } catch {
    // ignore and fall through
  }

  // 2) Fallback “summary” schema (what your quote page currently selects)
  try {
    const r = await db.execute(sql`
      select
        id,
        tenant_id,
        quote_log_id,
        kind,
        provider,
        provider_message_id,
        to_emails,
        subject,
        ok,
        error,
        created_at
      from quote_email_sends
      where id = ${args.emailId}::uuid
        and tenant_id = ${args.tenantId}::uuid
        and quote_log_id = ${args.quoteId}::uuid
      limit 1
    `);

    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
    return row ? (row as EmailRow) : null;
  } catch {
    return null;
  }
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

  const row = await fetchEmailRow({ tenantId, quoteId, emailId });

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
          <div className="mt-2">It may belong to a different tenant, or it may have been deleted.</div>
          <div className="mt-3 font-mono text-xs opacity-80">emailId={emailId}</div>
        </div>
      </div>
    );
  }

  const subject = safeTrim((row as any).subject) || "—";
  const kind = safeTrim((row as any).kind) || "composer";
  const initiatedBy = safeTrim((row as any).initiated_by) || "tenant";

  const provider = safeTrim((row as any).provider) || "—";
  const providerMessageId = safeTrim((row as any).provider_message_id) || "";

  const fromEmail = safeTrim((row as any).from_email ?? (row as any).from) || "—";

  const to =
    asEmailList((row as any).to_emails) ||
    asEmailList((row as any).to_json) ||
    [];
  const cc = asEmailList((row as any).cc_emails ?? (row as any).cc_json);
  const bcc = asEmailList((row as any).bcc_emails ?? (row as any).bcc_json);

  const createdAt = fmtWhen((row as any).created_at);

  const ok = Boolean((row as any).ok);
  const error = safeTrim((row as any).error);

  const htmlRaw = safeTrim((row as any).html);
  const textRaw = safeTrim((row as any).text);

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
          <span
            className={
              "inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold " +
              (ok
                ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"
                : "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200")
            }
          >
            {ok ? "sent" : "failed"}
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950/40">
        <div className="text-lg font-extrabold text-gray-900 dark:text-gray-100">{subject}</div>
        <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">When: {createdAt}</div>

        {!ok && error ? (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">From</div>
            <div className="mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{fromEmail}</div>

            <div className="mt-4 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">To</div>
            <div className="mt-2 text-sm text-gray-900 dark:text-gray-100">{to.length ? to.join(", ") : "—"}</div>

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
{JSON.stringify(safeJson((row as any).meta) ?? (row as any).meta ?? {}, null, 2)}
              </pre>
            </details>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950/40">
        <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">Email preview</div>
        <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">Read-only. Scripts are blocked.</div>

        {previewHtml ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
            <iframe
              title="Email preview"
              className="h-[820px] w-full bg-white"
              sandbox=""
              srcDoc={previewHtml}
            />
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-950/30 dark:text-gray-200">
            No HTML was stored for this email.
            <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
              If you want preview to always work, we should store <span className="font-mono">html</span> +{" "}
              <span className="font-mono">text</span> on send (composer + system sends).
            </div>
          </div>
        )}

        <details className="mt-4">
          <summary className="cursor-pointer select-none text-sm font-semibold text-gray-700 dark:text-gray-200">
            Plain text
          </summary>
          <pre className="mt-3 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-800 dark:bg-gray-950/30 dark:text-gray-100 whitespace-pre-wrap">
{textRaw || "—"}
          </pre>
        </details>

        {htmlRaw ? (
          <details className="mt-4">
            <summary className="cursor-pointer select-none text-sm font-semibold text-gray-700 dark:text-gray-200">
              Raw HTML
            </summary>
            <pre className="mt-3 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-800 dark:bg-gray-950/30 dark:text-gray-100 whitespace-pre-wrap">
{htmlRaw}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}