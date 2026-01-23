import Link from "next/link";
import Image from "next/image";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

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
  if (d.length <= 3) return a ? `(${a}` : "";
  if (d.length <= 6) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}

function pickLead(input: any) {
  const c = input?.customer ?? input?.contact ?? input?.customer_context ?? input?.lead ?? {};

  const name =
    c?.name ??
    c?.fullName ??
    c?.customerName ??
    input?.name ??
    input?.customer_context?.name ??
    "New customer";

  const phone = c?.phone ?? c?.phoneNumber ?? input?.phone ?? input?.customer_context?.phone ?? null;
  const email = c?.email ?? input?.email ?? input?.customer_context?.email ?? null;
  const notes = c?.notes ?? input?.notes ?? input?.customer_context?.notes ?? null;

  const phoneDigits = phone ? digitsOnly(String(phone)) : "";

  return {
    name: String(name || "New customer"),
    phone: phoneDigits ? formatUSPhone(phoneDigits) : null,
    email: email ? String(email) : null,
    notes: notes ? String(notes) : null,
  };
}

// Stage list excludes read/unread completely
const STAGES = [
  { key: "new", label: "New" },
  { key: "estimate", label: "Estimate" },
  { key: "quoted", label: "Quoted" },
  { key: "contacted", label: "Contacted" },
  { key: "scheduled", label: "Scheduled" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "archived", label: "Archived" },
] as const;

type StageKey = (typeof STAGES)[number]["key"];

function normalizeStage(s: unknown): StageKey {
  const v = String(s ?? "").toLowerCase().trim();
  const hit = STAGES.find((x) => x.key === v)?.key;
  return (hit ?? "new") as StageKey;
}

function prettyJson(x: any) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

function getSubmittedImages(input: any): string[] {
  const imgs = input?.images;
  if (Array.isArray(imgs)) return imgs.map((x: any) => x?.url).filter(Boolean);
  return [];
}

// Render images: only show if status rendered and we find explicit render URLs
function getRenderImages(row: any): string[] {
  const status = String(row?.renderStatus ?? "").toLowerCase();
  if (status !== "rendered") return [];

  const candidates: any[] = [
    row?.renderedImages,
    row?.render_images,
    row?.renderImages,
    row?.renderUrls,
    row?.render_urls,
    row?.output?.rendering?.images,
    row?.output?.rendered?.images,
  ];

  for (const c of candidates) {
    if (Array.isArray(c)) {
      const urls = c.map((x: any) => (typeof x === "string" ? x : x?.url)).filter(Boolean);
      if (urls.length) return urls;
    }
  }

  const one = row?.renderUrl ?? row?.render_url ?? row?.output?.renderUrl ?? row?.output?.render_url ?? null;
  return one ? [String(one)] : [];
}

type PageProps = {
  params: { id: string | string[] };
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function AdminQuoteDetailPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const rawId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const id = String(rawId || "").trim();
  if (!id) redirect("/admin/quotes");

  // 1) Load quote by ID FIRST (do not depend on tenant cookie)
  const row = await db
    .select({
      id: quoteLogs.id,
      tenantId: quoteLogs.tenantId,
      createdAt: quoteLogs.createdAt,
      input: quoteLogs.input,
      stage: quoteLogs.stage,
      isRead: quoteLogs.isRead,
      renderStatus: quoteLogs.renderStatus,
      output: (quoteLogs as any).output,
      renderedImages: (quoteLogs as any).renderedImages,
      renderUrl: (quoteLogs as any).renderUrl,
    })
    .from(quoteLogs)
    .where(eq(quoteLogs.id, id))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!row) redirect("/admin/quotes");

  const tenantId = row.tenantId;

  // 2) Enforce ownership (simple + safe)
  const tenant = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.ownerClerkUserId, userId)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!tenant) {
    // Don’t bounce to list instantly; show a clear access issue instead
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-3xl px-6 py-12">
          <h1 className="text-2xl font-semibold">Access denied</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            This quote doesn’t belong to your active tenant / account.
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

  // 3) Auto-mark read unless skipAutoRead=1
  const skipAutoRead =
    searchParams?.skipAutoRead === "1" ||
    (Array.isArray(searchParams?.skipAutoRead) && searchParams?.skipAutoRead.includes("1"));

  if (!skipAutoRead && row.isRead === false) {
    await db
      .update(quoteLogs)
      .set({ isRead: true } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    row.isRead = true;
  }

  async function markUnread() {
    "use server";
    await db
      .update(quoteLogs)
      .set({ isRead: false } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));

    // prevent auto-read flipping it back immediately
    redirect(`/admin/quotes/${encodeURIComponent(id)}?skipAutoRead=1`);
  }

  async function setStage(formData: FormData) {
    "use server";
    const next = normalizeStage(formData.get("stage"));
    await db
      .update(quoteLogs)
      .set({ stage: next } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    redirect(`/admin/quotes/${encodeURIComponent(id)}`);
  }

  const lead = pickLead(row.input);
  const submittedImages = getSubmittedImages(row.input);
  const renderImages = getRenderImages(row);

  const stage = normalizeStage(row.stage);
  const stageLabel = STAGES.find((s) => s.key === stage)?.label ?? "New";

  const ai = (row as any)?.output ?? null;
  const aiSummary =
    ai?.assessment?.summary ?? ai?.summary ?? ai?.assessment?.damage ?? ai?.assessment?.recommendation ?? null;

  const aiScope = ai?.assessment?.visible_scope ?? ai?.visible_scope ?? null;
  const aiAssumptions = ai?.assessment?.assumptions ?? ai?.assumptions ?? null;
  const aiQuestions = ai?.assessment?.questions ?? ai?.questions ?? null;

  const isRead = Boolean(row.isRead);

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/admin/quotes"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              ← Back
            </Link>

            <div className="leading-tight">
              <div className="text-xl font-semibold">{lead.name}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                {lead.phone ? <span className="font-mono">{lead.phone}</span> : <span className="italic">No phone</span>}
                {lead.email ? (
                  <>
                    <span>·</span>
                    <span className="font-mono">{lead.email}</span>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Read status pill */}
            <span
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-semibold",
                isRead
                  ? "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
                  : "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/30 dark:text-yellow-200"
              )}
            >
              {isRead ? "Read" : "Unread"}
            </span>

            {/* Only allow changing back to unread */}
            <form action={markUnread}>
              <button
                type="submit"
                disabled={!isRead}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm font-semibold border",
                  isRead
                    ? "border-yellow-200 bg-yellow-50 text-yellow-900 hover:bg-yellow-100 dark:border-yellow-900/50 dark:bg-yellow-950/30 dark:text-yellow-200 dark:hover:bg-yellow-950/50"
                    : "border-gray-200 bg-white text-gray-500 opacity-50 cursor-not-allowed dark:border-gray-800 dark:bg-black dark:text-gray-500"
                )}
              >
                Mark unread
              </button>
            </form>

            {/* Stage selector */}
            <form action={setStage} className="flex items-center gap-2">
              <span className="text-sm text-gray-600 dark:text-gray-300">Stage</span>
              <select
                name="stage"
                defaultValue={stage}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-black"
              >
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
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
        </div>

        {/* Meta strip */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-semibold text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200">
            {stageLabel}
          </span>
          <span>
            Submitted:{" "}
            <span className="font-semibold text-gray-700 dark:text-gray-200">
              {row.createdAt ? new Date(row.createdAt as any).toLocaleString() : "—"}
            </span>
          </span>
          {lead.notes ? (
            <>
              <span>·</span>
              <span className="italic">Customer notes: “{lead.notes}”</span>
            </>
          ) : null}
        </div>

        {/* Submitted photos */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
          <h2 className="text-lg font-semibold">Photo gallery</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Customer-submitted photos.</p>

          {submittedImages.length === 0 ? (
            <div className="mt-4 text-sm text-gray-600 dark:text-gray-300">No photos attached.</div>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {submittedImages.map((url, idx) => (
                <a
                  key={url + idx}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="group relative overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-black"
                  title="Open full size"
                >
                  <div className="relative aspect-square w-full">
                    <Image
                      src={url}
                      alt={`Submitted photo ${idx + 1}`}
                      fill
                      sizes="(max-width: 768px) 50vw, 25vw"
                      className="object-cover transition-transform group-hover:scale-[1.03]"
                    />
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>

        {/* Details layout */}
        <section className="grid gap-4 lg:grid-cols-3">
          {/* AI output */}
          <div className="lg:col-span-2 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
            <h2 className="text-lg font-semibold">AI assessment</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">AI output first.</p>

            {!ai ? (
              <div className="mt-4 text-sm text-gray-600 dark:text-gray-300">No AI output saved yet.</div>
            ) : (
              <div className="mt-4 space-y-4">
                {aiSummary ? (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-black">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Summary</div>
                    <div className="mt-2 whitespace-pre-wrap text-gray-900 dark:text-gray-100">{String(aiSummary)}</div>
                  </div>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2">
                  {Array.isArray(aiScope) && aiScope.length ? (
                    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Visible scope</div>
                      <ul className="mt-2 list-disc pl-5 text-sm text-gray-800 dark:text-gray-200">
                        {aiScope.slice(0, 12).map((x: any, i: number) => (
                          <li key={i}>{String(x)}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {Array.isArray(aiAssumptions) && aiAssumptions.length ? (
                    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Assumptions</div>
                      <ul className="mt-2 list-disc pl-5 text-sm text-gray-800 dark:text-gray-200">
                        {aiAssumptions.slice(0, 12).map((x: any, i: number) => (
                          <li key={i}>{String(x)}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>

                {Array.isArray(aiQuestions) && aiQuestions.length ? (
                  <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Questions</div>
                    <ul className="mt-2 list-disc pl-5 text-sm text-gray-800 dark:text-gray-200">
                      {aiQuestions.slice(0, 12).map((x: any, i: number) => (
                        <li key={i}>{String(x)}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Raw output</div>
                  <pre className="mt-2 max-h-[360px] overflow-auto rounded-lg bg-white p-3 text-[11px] text-gray-800 dark:bg-gray-950 dark:text-gray-200">
                    {prettyJson(ai)}
                  </pre>
                </div>
              </div>
            )}
          </div>

          {/* Customer details */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
            <h2 className="text-lg font-semibold">Customer details</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">What they submitted.</p>

            <div className="mt-4 space-y-3 text-sm">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Notes</div>
                <div className="mt-2 whitespace-pre-wrap text-gray-900 dark:text-gray-100">{lead.notes || "—"}</div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Contact</div>
                <div className="mt-2 space-y-1">
                  <div className="text-gray-900 dark:text-gray-100">{lead.name}</div>
                  <div className="text-gray-700 dark:text-gray-200">{lead.phone || "No phone"}</div>
                  <div className="text-gray-700 dark:text-gray-200">{lead.email || "No email"}</div>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Raw input</div>
                <pre className="mt-2 max-h-[240px] overflow-auto rounded-lg bg-gray-50 p-3 text-[11px] text-gray-800 dark:bg-black dark:text-gray-200">
                  {prettyJson(row.input)}
                </pre>
              </div>
            </div>
          </div>
        </section>

        {/* Rendering section */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Rendering</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Only shows when render images exist.</p>
            </div>
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-200">
              Status: {String(row.renderStatus ?? "—")}
            </span>
          </div>

          {renderImages.length === 0 ? (
            <div className="mt-4 text-sm text-gray-600 dark:text-gray-300">No render images available.</div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {renderImages.map((url, idx) => (
                <a
                  key={url + idx}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="group relative overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-black"
                  title="Open full size"
                >
                  <div className="relative aspect-[4/3] w-full">
                    <Image
                      src={url}
                      alt={`Render ${idx + 1}`}
                      fill
                      sizes="(max-width: 768px) 100vw, 33vw"
                      className="object-cover transition-transform group-hover:scale-[1.03]"
                    />
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}