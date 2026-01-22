// src/app/admin/quotes/[id]/page.tsx
import Link from "next/link";
import { cookies } from "next/headers";
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

function money(n: unknown) {
  const x = typeof n === "number" ? n : n == null ? null : Number(n);
  if (x == null || Number.isNaN(x)) return "";
  return x.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function fmtDate(iso: unknown) {
  const s = String(iso ?? "");
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s || "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
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

  const email =
    c?.email ??
    input?.email ??
    input?.customer_context?.email ??
    null;

  const phoneDigits = phone ? digitsOnly(String(phone)) : "";

  return {
    name: String(name || "New customer"),
    phone: phoneDigits ? formatUSPhone(phoneDigits) : null,
    email: email ? String(email) : null,
  };
}

// ✅ Stage excludes "read" (read/unread is separate)
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

function chip(label: string, tone: "gray" | "blue" | "green" | "yellow" | "red" = "gray") {
  const base = "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold";
  const cls =
    tone === "green"
      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/40 dark:bg-green-950/20 dark:text-green-200"
      : tone === "yellow"
      ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-950/20 dark:text-yellow-200"
      : tone === "red"
      ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-200"
      : tone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-200"
      : "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200";

  return <span className={cn(base, cls)}>{label}</span>;
}

function stageTone(stage: StageKey) {
  if (stage === "new") return "blue" as const;
  if (stage === "estimate" || stage === "quoted" || stage === "won") return "green" as const;
  if (stage === "lost" || stage === "archived") return "red" as const;
  return "gray" as const;
}

function renderStatusTone(s: string) {
  const v = s.toLowerCase();
  if (v === "rendered") return "green" as const;
  if (v === "failed") return "red" as const;
  if (v === "queued" || v === "running") return "blue" as const;
  return "gray" as const;
}

type PageProps = { params: Promise<{ id: string }> };

export default async function AdminQuoteReviewPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { id } = await params;

  const jar = await cookies();
  let tenantId = getCookieTenantId(jar);

  if (!tenantId) {
    const t = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.ownerClerkUserId, userId))
      .limit(1)
      .then((r) => r[0] ?? null);

    tenantId = t?.id ?? null;
  }

  if (!tenantId) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-5 text-sm text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-950/20 dark:text-yellow-200">
            No active tenant selected. Go to{" "}
            <Link className="underline" href="/onboarding">
              Settings
            </Link>{" "}
            and make sure your tenant is created/selected.
          </div>
        </div>
      </main>
    );
  }

  const row = await db
    .select({
      id: quoteLogs.id,
      tenantId: quoteLogs.tenantId,
      createdAt: quoteLogs.createdAt,
      input: quoteLogs.input,
      output: (quoteLogs as any).output, // may or may not exist
      estimateLow: (quoteLogs as any).estimateLow,
      estimateHigh: (quoteLogs as any).estimateHigh,
      inspectionRequired: (quoteLogs as any).inspectionRequired,
      summary: (quoteLogs as any).summary,
      isRead: quoteLogs.isRead,
      stage: quoteLogs.stage,
      renderStatus: quoteLogs.renderStatus,
      renderImageUrl: (quoteLogs as any).renderImageUrl,
    })
    .from(quoteLogs)
    .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!row) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-6xl px-6 py-10 space-y-4">
          <Link className="text-sm font-semibold underline" href="/admin/quotes">
            ← Back to Quotes
          </Link>
          <h1 className="text-2xl font-semibold">Quote not found</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Either it doesn’t exist or it doesn’t belong to the active tenant.
          </p>
        </div>
      </main>
    );
  }

  // ✅ Auto-mark read on open (server-side)
  if (!row.isRead) {
    await db
      .update(quoteLogs)
      .set({ isRead: true } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    row.isRead = true;
  }

  const lead = pickLead(row.input);
  const stage = normalizeStage(row.stage);

  const images: Array<{ url: string }> =
    (Array.isArray((row.input as any)?.images) ? (row.input as any).images : [])?.filter((x: any) => x?.url) ?? [];

  async function setStage(formData: FormData) {
    "use server";
    const nextRaw = String(formData.get("stage") ?? "").trim();
    const next = normalizeStage(nextRaw);

    await db
      .update(quoteLogs)
      .set({ stage: next } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));

    redirect(`/admin/quotes/${id}`);
  }

  async function markUnread() {
    "use server";
    // only action exposed on-page: mark back to unread
    await db
      .update(quoteLogs)
      .set({ isRead: false } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));

    redirect(`/admin/quotes/${id}`);
  }

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
        {/* Top row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/admin/quotes"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              ← Quotes
            </Link>

            <div className="hidden sm:flex items-center gap-2">
              {chip(row.isRead ? "Read" : "Unread", row.isRead ? "gray" : "yellow")}
              {chip(STAGES.find((s) => s.key === stage)?.label ?? stage, stageTone(stage))}
              {row.renderStatus ? chip(String(row.renderStatus), renderStatusTone(String(row.renderStatus))) : null}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* ✅ Only allow marking back to unread */}
            <form action={markUnread}>
              <button
                type="submit"
                className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm font-semibold text-yellow-900 hover:bg-yellow-100 dark:border-yellow-900/40 dark:bg-yellow-950/20 dark:text-yellow-200 dark:hover:bg-yellow-950/30"
              >
                Mark Unread
              </button>
            </form>

            <Link
              href={`/admin/quotes/${id}`}
              className="rounded-lg bg-black px-3 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
            >
              Refresh
            </Link>
          </div>
        </div>

        {/* Header card */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold truncate">{lead.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <span>{fmtDate(row.createdAt)}</span>
                <span className="text-gray-400">·</span>
                {lead.phone ? <span className="font-mono">{lead.phone}</span> : <span className="italic">No phone</span>}
                {lead.email ? (
                  <>
                    <span className="text-gray-400">·</span>
                    <span className="font-mono">{lead.email}</span>
                  </>
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap gap-2 sm:hidden">
                {chip(row.isRead ? "Read" : "Unread", row.isRead ? "gray" : "yellow")}
                {chip(STAGES.find((s) => s.key === stage)?.label ?? stage, stageTone(stage))}
                {row.renderStatus ? chip(String(row.renderStatus), renderStatusTone(String(row.renderStatus))) : null}
              </div>
            </div>

            {/* Stage picker */}
            <div className="w-full sm:w-[320px]">
              <div className="text-xs font-semibold tracking-wide text-gray-500">STAGE</div>
              <form action={setStage} className="mt-2 flex items-center gap-2">
                <select
                  name="stage"
                  defaultValue={stage}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-black"
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
              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Read/Unread is separate — opening a quote marks it read automatically.
              </div>
            </div>
          </div>

          {/* Pricing summary */}
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
              <div className="text-xs font-semibold tracking-wide text-gray-500">ESTIMATE</div>
              <div className="mt-2 text-lg font-semibold">
                {row.estimateLow != null || row.estimateHigh != null ? (
                  <>
                    {money(row.estimateLow)} {row.estimateHigh != null ? `– ${money(row.estimateHigh)}` : ""}
                  </>
                ) : (
                  <span className="text-gray-500">—</span>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
              <div className="text-xs font-semibold tracking-wide text-gray-500">INSPECTION</div>
              <div className="mt-2 text-lg font-semibold">
                {row.inspectionRequired === true ? "Required" : row.inspectionRequired === false ? "Not required" : "—"}
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
              <div className="text-xs font-semibold tracking-wide text-gray-500">QUOTE ID</div>
              <div className="mt-2 font-mono text-xs text-gray-700 dark:text-gray-300 break-all">{row.id}</div>
            </div>
          </div>

          {row.summary ? (
            <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-black">
              <div className="text-xs font-semibold tracking-wide text-gray-500">SUMMARY</div>
              <div className="mt-2 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                {String(row.summary)}
              </div>
            </div>
          ) : null}
        </section>

        {/* Images */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Customer photos</h2>
            <div className="text-sm text-gray-600 dark:text-gray-300">{images.length} photo(s)</div>
          </div>

          {images.length ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {images.map((img, idx) => (
                <a
                  key={`${img.url}-${idx}`}
                  href={img.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-black"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={`Photo ${idx + 1}`}
                    className="h-56 w-full object-cover transition-transform group-hover:scale-[1.02]"
                  />
                  <div className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300 truncate">{img.url}</div>
                </a>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-300">
              No photos were attached to this quote.
            </div>
          )}
        </section>

        {/* Render output if present */}
        {row.renderImageUrl ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">AI render</h2>
              {row.renderStatus ? chip(String(row.renderStatus), renderStatusTone(String(row.renderStatus))) : null}
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={String(row.renderImageUrl)} alt="Render" className="w-full max-h-[520px] object-contain bg-black" />
            </div>

            <div className="mt-3">
              <a
                href={String(row.renderImageUrl)}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-semibold underline text-gray-700 dark:text-gray-200"
              >
                Open render in new tab
              </a>
            </div>
          </section>
        ) : null}

        {/* Raw payloads */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
          <h2 className="text-lg font-semibold">Details</h2>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <details className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
              <summary className="cursor-pointer text-sm font-semibold">Input JSON</summary>
              <pre className="mt-3 overflow-auto text-[11px] leading-relaxed text-gray-800 dark:text-gray-200">
                {JSON.stringify(row.input ?? null, null, 2)}
              </pre>
            </details>

            <details className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
              <summary className="cursor-pointer text-sm font-semibold">Output JSON</summary>
              <pre className="mt-3 overflow-auto text-[11px] leading-relaxed text-gray-800 dark:text-gray-200">
                {JSON.stringify((row as any).output ?? null, null, 2)}
              </pre>
            </details>
          </div>
        </section>
      </div>
    </main>
  );
}