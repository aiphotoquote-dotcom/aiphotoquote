// src/app/admin/quotes/[id]/page.tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { quoteLogs } from "@/lib/db/schema";
import CopyButton from "@/components/CopyButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id?: string }>;
};

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
  if (s === "closed") return "closed";
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

function chipBase() {
  return "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold";
}

function stageChip(st: string) {
  const s = normalizeStage(st);
  if (s === "new")
    return cn(
      chipBase(),
      "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
    );
  if (s === "read")
    return cn(
      chipBase(),
      "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
    );
  if (s === "estimate")
    return cn(
      chipBase(),
      "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200"
    );
  if (s === "quoted")
    return cn(
      chipBase(),
      "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
    );
  if (s === "closed")
    return cn(
      chipBase(),
      "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200"
    );
  return cn(
    chipBase(),
    "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
  );
}

function renderChip(v: any) {
  const s = String(v ?? "").toLowerCase();
  if (!s || s === "not_requested")
    return cn(
      chipBase(),
      "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
    );
  if (s === "requested" || s === "queued")
    return cn(
      chipBase(),
      "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200"
    );
  if (s === "rendering" || s === "running")
    return cn(
      chipBase(),
      "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
    );
  if (s === "rendered" || s === "done")
    return cn(
      chipBase(),
      "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
    );
  if (s === "failed")
    return cn(
      chipBase(),
      "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
    );
  return cn(
    chipBase(),
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
    (output as any).estimateLow ??
    (output as any).low ??
    (output as any).min ??
    (output as any).estimate_low ??
    null;

  const high =
    (output as any).estimateHigh ??
    (output as any).high ??
    (output as any).max ??
    (output as any).estimate_high ??
    null;

  const inspection =
    (output as any).inspectionRequired ??
    (output as any).inspection_required ??
    (output as any).inspection ??
    null;

  const summary = (output as any).summary ?? (output as any).notes ?? (output as any).message ?? null;

  const toNum = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const L = toNum(low);
  const H = toNum(high);

  return {
    low: L,
    high: H,
    inspectionRequired:
      typeof inspection === "boolean"
        ? inspection
        : inspection == null
          ? null
          : String(inspection).toLowerCase() === "true",
    summary: summary ? String(summary) : null,
  };
}

function money(n: number | null) {
  if (n == null) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `$${n}`;
  }
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function getActiveTenantIdFromCookies() {
  const c = cookies();
  return (
    c.get("activeTenantId")?.value ||
    c.get("active_tenant_id")?.value ||
    c.get("activeTenant")?.value ||
    c.get("active_tenant")?.value ||
    null
  );
}

export default async function QuoteDetailPage(props: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const p = await props.params;
  const quoteId = String(p?.id ?? "").trim();
  if (!quoteId || !isUuid(quoteId)) notFound();

  const tenantId = getActiveTenantIdFromCookies();
  if (!tenantId || !isUuid(tenantId)) {
    // If we don't know what tenant we're in, route them back to quotes
    redirect("/admin/quotes");
  }

  async function updateStageAction(formData: FormData) {
    "use server";
    const next = String(formData.get("stage") ?? "").trim();
    const qid = String(formData.get("quoteId") ?? "").trim();
    const tid = String(formData.get("tenantId") ?? "").trim();

    if (!qid || !isUuid(qid)) return;
    if (!tid || !isUuid(tid)) return;
    if (!next) return;

    const normalized = normalizeStage(next);
    await db
      .update(quoteLogs)
      .set({ stage: normalized, isRead: true })
      .where(and(eq(quoteLogs.id, qid), eq(quoteLogs.tenantId, tid)));

    redirect(`/admin/quotes/${qid}`);
  }

  const row =
    (await db
      .select({
        id: quoteLogs.id,
        tenantId: quoteLogs.tenantId,
        createdAt: quoteLogs.createdAt,
        input: quoteLogs.input,
        output: quoteLogs.output,
        renderOptIn: quoteLogs.renderOptIn,
        renderStatus: quoteLogs.renderStatus,
        renderImageUrl: quoteLogs.renderImageUrl,
        isRead: quoteLogs.isRead,
        stage: quoteLogs.stage,
      })
      .from(quoteLogs)
      .where(and(eq(quoteLogs.id, quoteId), eq(quoteLogs.tenantId, tenantId)))
      .limit(1)
      .then((r) => r[0] ?? null)) || null;

  if (!row) notFound();

  const input = row.input as any;
  const output = row.output as any;

  const lead = pickLead(input);
  const images = pickImages(input);
  const estimate = pickEstimate(output);

  const submittedAt =
    (input?.createdAt ?? row.createdAt ?? null) as any;

  const stage = normalizeStage(row.stage);
  const renderStatus = String(row.renderStatus ?? "not_requested");

  const pageTitle = lead?.name ? `Lead • ${lead.name}` : "Lead";

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{pageTitle}</h1>
              <span className={stageChip(stage)}>Stage: {stageLabel(stage)}</span>
              <span className={renderChip(renderStatus)}>
                Render: {renderStatus.replaceAll("_", " ")}
              </span>
              {!row.isRead ? (
                <span className={cn(chipBase(), "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200")}>
                  Unread
                </span>
              ) : null}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600 dark:text-gray-300">
              <span>Submitted: {prettyDate(submittedAt)}</span>
              <span className="text-gray-300 dark:text-gray-700">•</span>
              <span className="font-mono text-xs">{row.id}</span>
              <CopyButton text={row.id} label="Copy" />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/admin/quotes"
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
            >
              Back to list
            </Link>
          </div>
        </div>

        {/* Layout */}
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          {/* Left column */}
          <div className="space-y-6 lg:col-span-1">
            {/* Customer card */}
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Customer
                  </div>
                  <div className="mt-1 text-lg font-semibold">{lead.name}</div>

                  <div className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-200">
                    {lead.phone ? (
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 dark:text-gray-400">📞</span>
                        <a className="underline decoration-gray-300 underline-offset-2" href={`tel:${lead.phoneDigits ?? ""}`}>
                          {lead.phone}
                        </a>
                      </div>
                    ) : null}

                    {lead.email ? (
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 dark:text-gray-400">✉️</span>
                        <a className="underline decoration-gray-300 underline-offset-2" href={`mailto:${lead.email}`}>
                          {lead.email}
                        </a>
                      </div>
                    ) : null}

                    {!lead.phone && !lead.email ? (
                      <div className="text-sm text-gray-600 dark:text-gray-300">No contact info found in input.</div>
                    ) : null}
                  </div>
                </div>
              </div>

              <form action={updateStageAction} className="mt-4 flex items-center gap-2">
                <input type="hidden" name="quoteId" value={row.id} />
                <input type="hidden" name="tenantId" value={row.tenantId} />

                <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                  Stage
                </label>

                <select
                  name="stage"
                  defaultValue={stage}
                  className="ml-1 flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                >
                  {STAGES.map((s) => (
                    <option key={s} value={s}>
                      {stageLabel(s)}
                    </option>
                  ))}
                </select>

                <button
                  type="submit"
                  className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                >
                  Save
                </button>
              </form>

              <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                Saving also marks the lead as read.
              </p>
            </section>

            {/* Render card */}
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Render
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-gray-600 dark:text-gray-300">Opt-in:</span>
                <span className="font-semibold">{row.renderOptIn ? "true" : "false"}</span>
                <span className="text-gray-300 dark:text-gray-700">•</span>
                <span className="text-gray-600 dark:text-gray-300">Status:</span>
                <span className="font-semibold">{renderStatus}</span>
              </div>

              {row.renderImageUrl ? (
                <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={row.renderImageUrl} alt="AI render" className="w-full object-cover" />
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
                  No render image available.
                </div>
              )}
            </section>
          </div>

          {/* Right column */}
          <div className="space-y-6 lg:col-span-2">
            {/* Estimate */}
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Estimate
                  </div>
                  <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">
                    {estimate?.low != null || estimate?.high != null ? (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold">Range:</span>
                        <span className="font-semibold">
                          {money(estimate.low) ?? "—"} – {money(estimate.high) ?? "—"}
                        </span>
                      </div>
                    ) : (
                      <div className="text-gray-600 dark:text-gray-300">No structured estimate values found.</div>
                    )}

                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold">Inspection required:</span>
                      <span className="font-semibold">
                        {estimate?.inspectionRequired == null ? "—" : estimate.inspectionRequired ? "Yes" : "No"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
                  {images.length} photo{images.length === 1 ? "" : "s"}
                </div>
              </div>

              {estimate?.summary ? (
                <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
                  {estimate.summary}
                </div>
              ) : null}
            </section>

            {/* Photos */}
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Photos
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-300">
                  Tap to open
                </div>
              </div>

              {images.length ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {images.map((img, idx) => (
                    <a
                      key={`${img.url}-${idx}`}
                      href={img.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.url}
                        alt={`photo ${idx + 1}`}
                        className="h-52 w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                      />
                      <div className="flex items-center justify-between gap-2 p-3">
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          Photo {idx + 1}
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-300">
                          Label: {img.shotType ?? "—"}
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
                  No photos found in input.
                </div>
              )}
            </section>

            {/* Raw */}
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Developer
              </div>

              <div className="mt-4 space-y-3">
                <details className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
                  <summary className="cursor-pointer text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Raw input
                  </summary>
                  <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
                    {JSON.stringify(input ?? null, null, 2)}
                  </pre>
                </details>

                <details className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
                  <summary className="cursor-pointer text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Raw output
                  </summary>
                  <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
                    {JSON.stringify(output ?? null, null, 2)}
                  </pre>
                </details>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}