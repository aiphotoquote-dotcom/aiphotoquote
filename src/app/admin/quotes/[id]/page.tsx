// src/app/admin/quotes/[id]/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { quoteLogs, tenants } from "@/lib/db/schema";
import CopyButton from "@/components/CopyButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function digitsOnly(s: string) {
  return (s || "").replace(/\D/g, "");
}

function formatUSPhone(raw: string) {
  const d = digitsOnly(raw).slice(0, 10);
  const a = d.slice(0, 3);
  const b = d.slice(3, 6);
  const c = d.slice(6, 10);
  if (!d) return "";
  if (d.length <= 3) return a ? `(${a}` : "";
  if (d.length <= 6) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}

function prettyDate(d: any) {
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return String(d ?? "");
    return dt.toLocaleString();
  } catch {
    return String(d ?? "");
  }
}

function normalizeStage(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "new";
  if (s === "quoted" || s === "quote") return "quoted";
  if (s === "read") return "read";
  if (s === "new") return "new";
  if (s === "estimate" || s === "estimated") return "estimate";
  if (s === "closed" || s === "won" || s === "lost") return "closed";
  return s;
}

const STAGES = ["new", "read", "estimate", "quoted", "closed"] as const;

function stageLabel(s: string) {
  const st = normalizeStage(s);
  if (st === "new") return "New";
  if (st === "read") return "Read";
  if (st === "estimate") return "Estimate";
  if (st === "quoted") return "Quoted";
  if (st === "closed") return "Closed";
  return st.charAt(0).toUpperCase() + st.slice(1);
}

function stageChip(st: string) {
  const s = normalizeStage(st);
  const base =
    "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold";
  if (s === "new")
    return cn(
      base,
      "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
    );
  if (s === "read")
    return cn(
      base,
      "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
    );
  if (s === "estimate")
    return cn(
      base,
      "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200"
    );
  if (s === "quoted")
    return cn(
      base,
      "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
    );
  if (s === "closed")
    return cn(
      base,
      "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200"
    );
  return cn(
    base,
    "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
  );
}

function renderChip(v: any) {
  const s = String(v ?? "").toLowerCase();
  const base =
    "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold";
  if (!s || s === "not_requested")
    return cn(
      base,
      "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
    );
  if (s === "requested" || s === "queued")
    return cn(
      base,
      "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200"
    );
  if (s === "rendering" || s === "running")
    return cn(
      base,
      "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
    );
  if (s === "rendered" || s === "done")
    return cn(
      base,
      "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
    );
  if (s === "failed")
    return cn(
      base,
      "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
    );
  return cn(
    base,
    "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
  );
}

function pickLead(input: any) {
  const c = input?.customer ?? input?.contact ?? input ?? null;

  const name =
    c?.name ??
    input?.name ??
    input?.customer_name ??
    input?.customerName ??
    null;

  const phone =
    c?.phone ??
    c?.phoneNumber ??
    input?.phone ??
    input?.customer_phone ??
    input?.customerPhone ??
    input?.customer_context?.phone ??
    null;

  const email =
    c?.email ??
    input?.email ??
    input?.customer_email ??
    input?.customerEmail ??
    input?.customer_context?.email ??
    null;

  const phoneDigits = phone ? digitsOnly(String(phone)) : "";

  return {
    name: String(name || "New customer"),
    phone: phoneDigits ? formatUSPhone(phoneDigits) : null,
    phoneDigits: phoneDigits || null,
    email: email ? String(email) : null,
  };
}

function pickImages(input: any): Array<{ url: string; shotType?: string }> {
  const imgs =
    input?.images ??
    input?.photos ??
    input?.input?.images ??
    input?.customer_context?.images ??
    null;

  if (!Array.isArray(imgs)) return [];
  return imgs
    .map((x: any) => ({
      url: String(x?.url ?? x?.src ?? x ?? "").trim(),
      shotType: x?.shotType ? String(x.shotType) : undefined,
    }))
    .filter((x: any) => x.url && /^https?:\/\//.test(x.url));
}

function pickEstimate(output: any) {
  if (!output || typeof output !== "object") return null;

  const low =
    output.estimateLow ??
    output.low ??
    output.min ??
    output.estimate_low ??
    null;

  const high =
    output.estimateHigh ??
    output.high ??
    output.max ??
    output.estimate_high ??
    null;

  const inspection =
    output.inspectionRequired ??
    output.inspection_required ??
    output.inspection ??
    null;

  const summary = output.summary ?? output.notes ?? output.message ?? null;

  const toNum = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const L = toNum(low);
  const H = toNum(high);

  return {
    low: L,
    high: H,
    inspection: typeof inspection === "boolean" ? inspection : null,
    summary: summary ? String(summary) : null,
  };
}

export default async function AdminQuoteDetailPage({
  params,
}: {
  params: Promise<{ id?: string }> | { id?: string };
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const resolved = await params;
  const quoteId = resolved?.id ? String(resolved.id) : "";
  if (!quoteId) notFound();

  // 1) Load the quote by ID ONLY (do NOT depend on tenant cookie)
  const base = await db
    .select({
      id: quoteLogs.id,
      tenantId: quoteLogs.tenantId,
    })
    .from(quoteLogs)
    .where(eq(quoteLogs.id, quoteId))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!base?.tenantId) notFound();

  const quoteTenantId = base.tenantId;

  // 2) Authorize: for now, owner-only (later we can add tenant_members)
  const ownerOk = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.id, quoteTenantId), eq(tenants.ownerClerkUserId, userId)))
    .limit(1)
    .then((r) => Boolean(r[0]));

  if (!ownerOk) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <h1 className="text-2xl font-semibold">Not authorized</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            This quote belongs to a tenant you don’t have access to.
          </p>
          <div className="mt-6">
            <Link className="underline" href="/admin/quotes">
              Back to quotes
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // ----- Server action: update stage -----
  async function updateStage(formData: FormData) {
    "use server";
    const next = normalizeStage(formData.get("stage"));
    await db
      .update(quoteLogs)
      .set({ stage: next, isRead: true })
      .where(and(eq(quoteLogs.id, quoteId), eq(quoteLogs.tenantId, quoteTenantId)));

    redirect(`/admin/quotes/${quoteId}`);
  }

  // 3) Load full quote (scoped to the quote's tenant)
  const row = await db
    .select({
      id: quoteLogs.id,
      tenantId: quoteLogs.tenantId,
      createdAt: quoteLogs.createdAt,
      input: quoteLogs.input,
      output: quoteLogs.output,
      renderOptIn: quoteLogs.renderOptIn,
      renderStatus: quoteLogs.renderStatus,
      renderImageUrl: quoteLogs.renderImageUrl,
      renderPrompt: quoteLogs.renderPrompt,
      renderError: quoteLogs.renderError,
      renderedAt: quoteLogs.renderedAt,
      isRead: quoteLogs.isRead,
      stage: quoteLogs.stage,
    })
    .from(quoteLogs)
    .where(and(eq(quoteLogs.id, quoteId), eq(quoteLogs.tenantId, quoteTenantId)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!row) notFound();

  // Mark as read on open (best-effort)
  // Also bump stage from "new" -> "read" without clobbering other stages.
  if (!row.isRead) {
    try {
      await db
        .update(quoteLogs)
        .set({
          isRead: true,
          stage: sql`case when ${quoteLogs.stage} = 'new' then 'read' else ${quoteLogs.stage} end`,
        })
        .where(and(eq(quoteLogs.id, quoteId), eq(quoteLogs.tenantId, quoteTenantId)));

      row.isRead = true;
      if (normalizeStage(row.stage) === "new") row.stage = "read";
    } catch {
      // ignore
    }
  }

  const lead = pickLead(row.input);
  const imgs = pickImages(row.input);
  const est = pickEstimate(row.output);

  const stage = normalizeStage(row.stage);
  const unread = !row.isRead;

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Lead</h1>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
                  unread
                    ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200"
                    : "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
                )}
              >
                {unread ? "Unread" : "Read"}
              </span>

              <span className={stageChip(stage)}>Stage: {stageLabel(stage)}</span>
              <span className={renderChip(row.renderStatus)}>
                Render: {String(row.renderStatus || "—")}
              </span>
            </div>

            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Submitted: {prettyDate(row.createdAt)}
            </div>

            <div className="mt-2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span className="font-mono">{row.id}</span>
              <CopyButton value={row.id} label="Copy" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/admin/quotes"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Back to list
            </Link>
          </div>
        </div>

        {/* Lead card */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Customer</div>
              <div className="mt-2 text-lg font-semibold">{lead.name}</div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                {lead.phone ? <span className="font-mono">{lead.phone}</span> : <i>No phone</i>}
                {lead.email ? (
                  <>
                    {" "}
                    · <span className="font-mono">{lead.email}</span>
                  </>
                ) : null}
              </div>
            </div>

            <form action={updateStage} className="flex items-center gap-2">
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                Stage
              </label>
              <select
                name="stage"
                defaultValue={stage}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {stageLabel(s)}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                Save
              </button>
            </form>
          </div>
        </section>

        {/* Estimate */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="font-semibold">Estimate</div>
          {est ? (
            <div className="mt-3 text-sm text-gray-700 dark:text-gray-300 space-y-1">
              <div>
                Range:{" "}
                <b>
                  {est.low != null ? `$${est.low.toLocaleString()}` : "—"} –{" "}
                  {est.high != null ? `$${est.high.toLocaleString()}` : "—"}
                </b>
              </div>
              <div>
                Inspection required:{" "}
                <b>{est.inspection == null ? "—" : est.inspection ? "Yes" : "No"}</b>
              </div>
              {est.summary ? <div className="mt-2">{est.summary}</div> : null}
            </div>
          ) : (
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">No structured estimate found.</div>
          )}
        </section>

        {/* Photos */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="font-semibold">Photos</div>
          {imgs.length ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {imgs.map((p, idx) => (
                <a
                  key={`${p.url}-${idx}`}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-gray-200 overflow-hidden hover:opacity-95 dark:border-gray-800"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`photo ${idx + 1}`} className="h-48 w-full object-cover" />
                  <div className="p-3 text-xs text-gray-600 dark:text-gray-300">
                    {p.shotType ? `Label: ${p.shotType}` : "Photo"}
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">No photos on this lead.</div>
          )}
        </section>

        {/* Raw */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="font-semibold">Raw</div>
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            <div>
              <div className="text-xs text-gray-500">input</div>
              <pre className="mt-2 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-100">
                {JSON.stringify(row.input ?? null, null, 2)}
              </pre>
            </div>
            <div>
              <div className="text-xs text-gray-500">output</div>
              <pre className="mt-2 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-100">
                {JSON.stringify(row.output ?? null, null, 2)}
              </pre>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}