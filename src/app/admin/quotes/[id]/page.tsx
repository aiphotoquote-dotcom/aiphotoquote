import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { quoteLogs, tenants } from "@/lib/db/schema";
import QuotePhotoGallery, { type QuotePhoto } from "@/components/admin/QuotePhotoGallery";

export const runtime = "nodejs";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function getCookieTenantId(jar: Awaited<ReturnType<typeof cookies>>) {
  const candidates = [
    jar.get("activeTenantId")?.value,
    jar.get("active_tenant_id")?.value,
    jar.get("tenantId")?.value,
    jar.get("tenant_id")?.value,
  ].filter(Boolean) as string[];

  return candidates[0] || null;
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
  const c =
    input?.customer ??
    input?.contact ??
    input?.customer_context?.customer ??
    input?.lead ??
    input?.contact ??
    {};

  const name =
    c?.name ??
    c?.fullName ??
    c?.customerName ??
    input?.name ??
    input?.customer_context?.name ??
    "New customer";

  const phone =
    c?.phone ??
    c?.phoneNumber ??
    input?.phone ??
    input?.customer_context?.phone ??
    null;

  const email = c?.email ?? input?.email ?? input?.customer_context?.email ?? null;

  const phoneDigits = phone ? digitsOnly(String(phone)) : "";

  return {
    name: String(name || "New customer"),
    phone: phoneDigits ? formatUSPhone(phoneDigits) : null,
    phoneDigits: phoneDigits || null,
    email: email ? String(email) : null,
  };
}

function pickCustomerNotes(input: any) {
  const notes =
    input?.customer_context?.notes ??
    input?.customer_context?.customer?.notes ??
    input?.notes ??
    input?.customerNotes ??
    input?.message ??
    null;

  const s = notes == null ? "" : String(notes).trim();
  return s || "";
}

function pickPhotos(input: any): QuotePhoto[] {
  const out: QuotePhoto[] = [];

  const images = Array.isArray(input?.images) ? input.images : null;
  if (images) for (const it of images) if (it?.url) out.push({ url: String(it.url), label: it?.label ?? null });

  const photos = Array.isArray(input?.photos) ? input.photos : null;
  if (photos) for (const it of photos) if (it?.url) out.push({ url: String(it.url), label: it?.label ?? null });

  const imageUrls = Array.isArray(input?.imageUrls) ? input.imageUrls : null;
  if (imageUrls) for (const url of imageUrls) if (url) out.push({ url: String(url) });

  const ccImages = Array.isArray(input?.customer_context?.images) ? input.customer_context.images : null;
  if (ccImages) for (const it of ccImages) if (it?.url) out.push({ url: String(it.url), label: it?.label ?? null });

  const seen = new Set<string>();
  return out.filter((p) => (p?.url && !seen.has(p.url) ? (seen.add(p.url), true) : false));
}

function pickAiDetails(input: any) {
  // We don’t know the exact shape, so we defensively look in common spots.
  const candidates = [
    input?.ai_output,
    input?.ai,
    input?.assessment,
    input?.ai_assessment,
    input?.aiAssessment,
    input?.estimate,
    input?.ai_estimate,
    input?.aiEstimate,
    input?.result,
    input?.output,
  ].filter(Boolean);

  return candidates[0] ?? null;
}

function pickRenderUrls(input: any): string[] {
  const urls: string[] = [];

  const tryPush = (v: any) => {
    if (!v) return;
    if (typeof v === "string" && v.startsWith("http")) urls.push(v);
  };

  // common spots
  tryPush(input?.renderUrl);
  tryPush(input?.render_url);
  tryPush(input?.renderedImageUrl);
  tryPush(input?.rendered_image_url);
  tryPush(input?.rendering?.url);
  tryPush(input?.rendered?.url);
  tryPush(input?.render?.url);

  // arrays
  if (Array.isArray(input?.renderedImages)) for (const x of input.renderedImages) tryPush(x?.url ?? x);
  if (Array.isArray(input?.renderings)) for (const x of input.renderings) tryPush(x?.url ?? x);

  // de-dupe
  return Array.from(new Set(urls));
}

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

function normalizeStage(s: unknown): StageKey | "read" {
  const v = String(s ?? "").toLowerCase().trim();
  if (v === "read") return "read"; // legacy
  const hit = STAGES.find((x) => x.key === v)?.key;
  return (hit ?? "new") as StageKey;
}

function chip(label: string, tone: "gray" | "blue" | "yellow" | "green" | "red" = "gray") {
  const base = "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold";
  const cls =
    tone === "green"
      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
      : tone === "yellow"
      ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200"
      : tone === "red"
      ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
      : tone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
      : "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-200";

  return <span className={cn(base, cls)}>{label}</span>;
}

function renderChip(renderStatusRaw: unknown) {
  const s = String(renderStatusRaw ?? "").toLowerCase().trim();
  if (!s) return null;
  if (s === "rendered") return chip("Rendered", "green");
  if (s === "failed") return chip("Render failed", "red");
  if (s === "queued" || s === "running") return chip(s === "queued" ? "Queued" : "Rendering…", "blue");
  return chip(s, "gray");
}

type PageProps = {
  params: Promise<{ id: string }> | { id: string };
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
};

export default async function QuoteReviewPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const p = await params;
  const id = String((p as any)?.id ?? "").trim();
  if (!id) redirect("/admin/quotes");

  const sp = searchParams ? await searchParams : {};
  const stayUnread =
    sp.stay_unread === "1" || (Array.isArray(sp.stay_unread) && sp.stay_unread.includes("1"));

  const jar = await cookies();
  let tenantIdMaybe = getCookieTenantId(jar);

  if (!tenantIdMaybe) {
    const t = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.ownerClerkUserId, userId))
      .limit(1)
      .then((r) => r[0] ?? null);

    tenantIdMaybe = t?.id ?? null;
  }

  if (!tenantIdMaybe) redirect("/admin/quotes");
  const tenantId = tenantIdMaybe;

  const row = await db
    .select({
      id: quoteLogs.id,
      createdAt: quoteLogs.createdAt,
      input: quoteLogs.input,
      stage: quoteLogs.stage,
      isRead: quoteLogs.isRead,
      renderStatus: quoteLogs.renderStatus,
    })
    .from(quoteLogs)
    .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!row) redirect("/admin/quotes");

  // ✅ Auto-mark read ONLY when not explicitly staying unread
  if (!stayUnread && !row.isRead) {
    await db
      .update(quoteLogs)
      .set({ isRead: true } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
  }

  const effectiveIsRead = stayUnread ? false : Boolean(row.isRead);
  const lead = pickLead(row.input);
  const notes = pickCustomerNotes(row.input);

  const stageNorm = normalizeStage(row.stage);
  const stageLabel =
    stageNorm === "read" ? "Read (legacy)" : STAGES.find((s) => s.key === stageNorm)?.label ?? "New";

  const photos = pickPhotos(row.input);
  const aiDetails = pickAiDetails(row.input);
  const renderUrls = pickRenderUrls(row.input);

  async function setStage(formData: FormData) {
    "use server";
    const next = String(formData.get("stage") ?? "").trim().toLowerCase();
    const allowed = new Set(STAGES.map((s) => s.key));
    if (!allowed.has(next as any)) redirect(`/admin/quotes/${id}`);

    await db
      .update(quoteLogs)
      .set({ stage: next } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));

    redirect(`/admin/quotes/${id}`);
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
      {/* Top row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/admin/quotes" className="text-sm font-semibold text-gray-600 hover:underline dark:text-gray-300">
            ← Back to quotes
          </Link>

          <h1 className="mt-2 text-2xl font-semibold">Quote review</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Submitted {row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {effectiveIsRead ? chip("Read", "gray") : chip("Unread", "yellow")}
          {renderChip(row.renderStatus)}

          {/* ✅ Toggle button changes based on current effective state */}
          {effectiveIsRead ? (
            <form action={`/api/admin/quotes/${id}/read`} method="POST">
              <input type="hidden" name="isRead" value="0" />
              <button
                type="submit"
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
              >
                Mark unread
              </button>
            </form>
          ) : (
            <form action={`/api/admin/quotes/${id}/read`} method="POST">
              <input type="hidden" name="isRead" value="1" />
              <button
                type="submit"
                className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                Mark read
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Lead + Stage card */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{lead.name}</h2>
              {chip(stageLabel, stageNorm === "new" ? "blue" : "gray")}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-700 dark:text-gray-200">
              {lead.phone ? (
                <a
                  href={`tel:${lead.phoneDigits ?? digitsOnly(lead.phone)}`}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm hover:bg-white dark:border-gray-800 dark:bg-black dark:hover:bg-gray-900"
                >
                  {lead.phone}
                </a>
              ) : (
                <span className="italic text-gray-500">No phone</span>
              )}

              {lead.email ? (
                <a
                  href={`mailto:${lead.email}`}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm hover:bg-white dark:border-gray-800 dark:bg-black dark:hover:bg-gray-900"
                >
                  {lead.email}
                </a>
              ) : null}
            </div>
          </div>

          <div className="w-full lg:w-[340px]">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black">
              <div className="text-sm font-semibold">Stage</div>
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">Stage is separate from read/unread.</p>

              <form action={setStage} className="mt-4 flex items-center gap-2">
                <select
                  name="stage"
                  defaultValue={stageNorm === "read" ? "new" : (stageNorm as any)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
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

              {stageNorm === "read" ? (
                <div className="mt-3 text-xs text-yellow-900 dark:text-yellow-200">
                  Note: this quote has a legacy stage value <span className="font-mono">read</span>. Saving will normalize it.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* Photos (submitted by customer) */}
      <QuotePhotoGallery photos={photos} />

      {/* Customer notes */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div>
          <h3 className="text-lg font-semibold">Customer notes</h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">What the customer told you when submitting.</p>
        </div>

        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-200">
          {notes ? (
            <div className="whitespace-pre-wrap leading-relaxed">{notes}</div>
          ) : (
            <div className="italic text-gray-500">No notes provided.</div>
          )}
        </div>
      </section>

      {/* ✅ DETAILS (AI output first, then rendering if present) */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950 space-y-5">
        <div>
          <h3 className="text-lg font-semibold">Details</h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            AI output first. Rendering (if generated) appears below.
          </p>
        </div>

        {/* AI output */}
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold">AI output</div>
            {chip("Auto-generated", "blue")}
          </div>

          <div className="mt-3">
            {aiDetails ? (
              <pre className="overflow-auto rounded-xl border border-gray-200 bg-black p-4 text-xs text-white dark:border-gray-800">
{typeof aiDetails === "string" ? aiDetails : JSON.stringify(aiDetails, null, 2)}
              </pre>
            ) : (
              <div className="text-sm text-gray-600 dark:text-gray-300">
                No AI output found in this submission payload.
              </div>
            )}
          </div>
        </div>

        {/* Rendering (only if renderStatus says rendered OR we find URLs) */}
        {String(row.renderStatus ?? "").toLowerCase() === "rendered" || renderUrls.length ? (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold">Rendering</div>
              {chip(String(row.renderStatus || "rendered"), "green")}
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {renderUrls.length ? (
                renderUrls.map((u) => (
                  <a
                    key={u}
                    href={u}
                    target="_blank"
                    rel="noreferrer"
                    className="group overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="Rendered result" className="h-56 w-full object-cover transition group-hover:scale-[1.01]" />
                    <div className="p-3 text-xs text-gray-600 dark:text-gray-300">Tap to open</div>
                  </a>
                ))
              ) : (
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  Marked as rendered, but no render URL was found in the payload.
                </div>
              )}
            </div>
          </div>
        ) : null}
      </section>

      {/* Raw payload (optional) */}
      <details className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <summary className="cursor-pointer text-sm font-semibold">Raw submission payload</summary>
        <pre className="mt-4 overflow-auto rounded-xl border border-gray-200 bg-black p-4 text-xs text-white dark:border-gray-800">
{JSON.stringify(row.input ?? {}, null, 2)}
        </pre>
      </details>
    </div>
  );
}