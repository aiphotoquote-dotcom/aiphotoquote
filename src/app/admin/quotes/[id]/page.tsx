// src/app/admin/quotes/[id]/page.tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { quoteLogs, tenants } from "@/lib/db/schema";

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
  // canonicalize a few common ones
  if (s === "quoted" || s === "quote") return "quoted";
  if (s === "read") return "read";
  if (s === "new") return "new";
  if (s === "estimate" || s === "estimated") return "estimate";
  return s;
}

const STAGES = ["new", "read", "estimate", "quoted", "closed"];

function stageLabel(s: string) {
  const st = normalizeStage(s);
  if (st === "new") return "New";
  if (st === "read") return "Read";
  if (st === "estimate") return "Estimate";
  if (st === "quoted") return "Quoted";
  if (st === "closed") return "Closed";
  // fallback for custom stages
  return st.charAt(0).toUpperCase() + st.slice(1);
}

function stageChip(st: string) {
  const s = normalizeStage(st);
  const base =
    "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold";
  if (s === "new") return cn(base, "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200");
  if (s === "read") return cn(base, "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200");
  if (s === "estimate") return cn(base, "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200");
  if (s === "quoted") return cn(base, "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200");
  if (s === "closed") return cn(base, "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200");
  return cn(base, "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200");
}

function renderChip(v: any) {
  const s = String(v ?? "").toLowerCase();
  const base =
    "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold";
  if (!s || s === "not_requested")
    return cn(base, "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200");
  if (s === "requested" || s === "queued")
    return cn(base, "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200");
  if (s === "rendering" || s === "running")
    return cn(base, "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200");
  if (s === "rendered" || s === "done")
    return cn(base, "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200");
  if (s === "failed")
    return cn(base, "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200");
  return cn(base, "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200");
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
    inspection:
      typeof inspection === "boolean"
        ? inspection
        : inspection == null
          ? null
          : Boolean(inspection),
    summary: summary ? String(summary) : null,
  };
}

type PageProps = {
  params: { id: string };
};

export default async function QuoteDetailPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const quoteId = String(params?.id ?? "").trim();
  if (!quoteId) notFound();

  const jar = await cookies();
  const activeTenantId =
    jar.get("activeTenantId")?.value ||
    jar.get("active_tenant_id")?.value ||
    jar.get("tenantId")?.value ||
    jar.get("tenant_id")?.value ||
    null;

  // Fallback to owner tenant if cookie missing
  let tenantId = activeTenantId;
  if (!tenantId) {
    const t = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.ownerClerkUserId, userId))
      .limit(1)
      .then((r) => r[0] ?? null);

    tenantId = t?.id ?? null;
  }

  if (!tenantId) redirect("/admin");

  const row = await db
    .select({
      id: quoteLogs.id,
      tenantId: quoteLogs.tenantId,
      createdAt: quoteLogs.createdAt,
      input: quoteLogs.input,
      output: quoteLogs.output,
      stage: quoteLogs.stage,
      isRead: quoteLogs.isRead,
      renderOptIn: quoteLogs.renderOptIn,
      renderStatus: quoteLogs.renderStatus,
      renderImageUrl: (quoteLogs as any).renderImageUrl ?? null, // safe if column exists; ignored if not
    })
    .from(quoteLogs)
    .where(and(eq(quoteLogs.id, quoteId), eq(quoteLogs.tenantId, tenantId)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!row) notFound();

  const lead = pickLead(row.input);
  const imgs = pickImages(row.input);
  const est = pickEstimate(row.output);

  async function updateStage(formData: FormData) {
    "use server";
    const nextRaw = String(formData.get("stage") ?? "").trim();
    const next = normalizeStage(nextRaw);

    // allow custom stages, but keep sane strings
    if (!next || next.length > 48) return;

    await db
      .update(quoteLogs)
      .set({ stage: next, isRead: true })
      .where(and(eq(quoteLogs.id, quoteId), eq(quoteLogs.tenantId, tenantId)));

    redirect(`/admin/quotes/${quoteId}`);
  }

  async function markRead() {
    "use server";
    await db
      .update(quoteLogs)
      .set({ isRead: true })
      .where(and(eq(quoteLogs.id, quoteId), eq(quoteLogs.tenantId, tenantId)));

    redirect(`/admin/quotes/${quoteId}`);
  }

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/admin/quotes"
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800"
            >
              ← Back to quotes
            </Link>

            <div className="hidden sm:flex items-center gap-2">
              <span className={stageChip(String(row.stage))}>Stage: {stageLabel(String(row.stage))}</span>
              <span className={renderChip(row.renderStatus)}>Render: {String(row.renderStatus ?? "not_requested")}</span>
              {!row.isRead ? (
                <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200">
                  Unread
                </span>
              ) : null}
            </div>
          </div>

          <div className="text-right">
            <div className="text-xs text-gray-500 dark:text-gray-400">Quote ID</div>
            <div className="font-mono text-xs text-gray-700 dark:text-gray-200">{row.id}</div>
          </div>
        </div>

        {/* Header */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{lead.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                {lead.phone ? (
                  <a className="underline" href={`tel:${lead.phoneDigits ?? ""}`}>
                    {lead.phone}
                  </a>
                ) : (
                  <span className="text-gray-500 dark:text-gray-400">No phone</span>
                )}
                <span className="text-gray-300 dark:text-gray-700">•</span>
                {lead.email ? (
                  <a className="underline" href={`mailto:${lead.email}`}>
                    {lead.email}
                  </a>
                ) : (
                  <span className="text-gray-500 dark:text-gray-400">No email</span>
                )}
              </div>

              <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                Submitted: <span className="font-semibold text-gray-700 dark:text-gray-200">{prettyDate(row.createdAt)}</span>
              </div>

              {/* Mobile chips */}
              <div className="mt-4 flex flex-wrap gap-2 sm:hidden">
                <span className={stageChip(String(row.stage))}>Stage: {stageLabel(String(row.stage))}</span>
                <span className={renderChip(row.renderStatus)}>Render: {String(row.renderStatus ?? "not_requested")}</span>
                {!row.isRead ? (
                  <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200">
                    Unread
                  </span>
                ) : null}
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3 min-w-[260px]">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Quick actions</div>

                <form action={updateStage} className="mt-3 flex items-center gap-2">
                  <label className="text-xs text-gray-600 dark:text-gray-300">Stage</label>
                  <select
                    name="stage"
                    defaultValue={normalizeStage(row.stage)}
                    className="ml-auto rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-900"
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

                {!row.isRead ? (
                  <form action={markRead} className="mt-2">
                    <button
                      type="submit"
                      className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800"
                    >
                      Mark read
                    </button>
                  </form>
                ) : null}
              </div>

              {/* Estimate summary */}
              <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Estimate</div>

                {est ? (
                  <div className="mt-2 space-y-2">
                    <div className="text-lg font-semibold">
                      {est.low != null && est.high != null ? (
                        <>
                          ${est.low.toLocaleString()} – ${est.high.toLocaleString()}
                        </>
                      ) : (
                        <span className="text-gray-500 dark:text-gray-400">No range available</span>
                      )}
                    </div>

                    <div className="text-sm text-gray-700 dark:text-gray-200">
                      Inspection:{" "}
                      <span className="font-semibold">
                        {est.inspection == null ? "Unknown" : est.inspection ? "Required" : "Not required"}
                      </span>
                    </div>

                    {est.summary ? (
                      <div className="text-sm text-gray-700 dark:text-gray-200">
                        <span className="font-semibold">Summary:</span> {est.summary}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">No output recorded yet.</div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Photos */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Photos</h2>
            <div className="text-xs text-gray-500 dark:text-gray-400">{imgs.length} photo{imgs.length === 1 ? "" : "s"}</div>
          </div>

          {imgs.length ? (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {imgs.map((im, idx) => (
                <div key={`${im.url}-${idx}`} className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={im.url} alt={`photo ${idx + 1}`} className="h-56 w-full object-cover" />
                    {im.shotType ? (
                      <div className="absolute left-2 top-2 rounded-full bg-black/80 px-2 py-1 text-xs font-semibold text-white">
                        {im.shotType}
                      </div>
                    ) : null}
                    <a
                      href={im.url}
                      target="_blank"
                      rel="noreferrer"
                      className="absolute right-2 top-2 rounded-lg bg-white/90 px-2 py-1 text-xs font-semibold text-gray-900 hover:bg-white dark:bg-gray-900/90 dark:text-gray-100"
                    >
                      Open
                    </a>
                  </div>

                  <div className="p-3">
                    <div className="text-xs text-gray-500 dark:text-gray-400">Photo {idx + 1}</div>
                    <div className="mt-1 font-mono text-[11px] break-all text-gray-700 dark:text-gray-200">
                      {im.url}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
              No images found in this quote input.
            </div>
          )}
        </section>

        {/* Render */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-lg font-semibold">AI Render</h2>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <div>
              Opt-in: <span className="font-semibold">{String(Boolean(row.renderOptIn))}</span>
            </div>
            <span className="text-gray-300 dark:text-gray-700">•</span>
            <div>
              Status: <span className={renderChip(row.renderStatus)}>{String(row.renderStatus ?? "not_requested")}</span>
            </div>
          </div>

          {row.renderImageUrl ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={String(row.renderImageUrl)} alt="AI render" className="w-full object-cover" />
            </div>
          ) : null}
        </section>

        {/* Input + Output */}
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <h2 className="text-lg font-semibold">Input</h2>

            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-gray-700 dark:text-gray-200">
                View raw JSON
              </summary>
              <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                {JSON.stringify(row.input ?? null, null, 2)}
              </pre>
            </details>

            {/* Helpful extracted bits */}
            <div className="mt-4 space-y-2 text-sm">
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Parsed</div>
              <div className="text-gray-700 dark:text-gray-200">
                Category:{" "}
                <span className="font-semibold">
                  {String(row.input?.customer_context?.category ?? "service")}
                </span>
              </div>
              <div className="text-gray-700 dark:text-gray-200">
                Service type:{" "}
                <span className="font-semibold">
                  {String(row.input?.customer_context?.service_type ?? "upholstery")}
                </span>
              </div>
              {row.input?.customer_context?.notes ? (
                <div className="text-gray-700 dark:text-gray-200">
                  Notes: <span className="font-semibold">{String(row.input.customer_context.notes)}</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <h2 className="text-lg font-semibold">Output</h2>

            <details className="mt-3" open>
              <summary className="cursor-pointer text-sm font-semibold text-gray-700 dark:text-gray-200">
                View raw JSON
              </summary>
              <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                {JSON.stringify(row.output ?? null, null, 2)}
              </pre>
            </details>

            {est?.summary ? (
              <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Customer-friendly summary</div>
                <div className="mt-2">{est.summary}</div>
              </div>
            ) : null}
          </div>
        </section>

        <div className="pb-10 text-xs text-gray-500 dark:text-gray-400">
          Tip: photos + notes drive estimate quality. Stage updates automatically mark as read.
        </div>
      </div>
    </main>
  );
}