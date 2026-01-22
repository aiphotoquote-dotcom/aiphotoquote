// src/app/admin/quotes/[id]/page.tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { quoteLogs, tenants } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
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
  const notes = input?.customer_context?.notes ?? input?.notes ?? null;
  const serviceType = input?.customer_context?.service_type ?? input?.service_type ?? null;
  const category = input?.customer_context?.category ?? input?.category ?? null;

  const phoneDigits = phone ? digitsOnly(String(phone)) : "";

  return {
    name: String(name || "New customer"),
    phone: phoneDigits ? formatUSPhone(phoneDigits) : null,
    email: email ? String(email) : null,
    notes: notes ? String(notes) : null,
    serviceType: serviceType ? String(serviceType) : null,
    category: category ? String(category) : null,
  };
}

type StageKey =
  | "new"
  | "estimate"
  | "quoted"
  | "contacted"
  | "scheduled"
  | "won"
  | "lost"
  | "archived";

const STAGES: Array<{ key: StageKey; label: string }> = [
  { key: "new", label: "New" },
  { key: "estimate", label: "Estimate" },
  { key: "quoted", label: "Quoted" },
  { key: "contacted", label: "Contacted" },
  { key: "scheduled", label: "Scheduled" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "archived", label: "Archived" },
];

function normalizeStage(s: unknown): StageKey {
  const v = String(s ?? "").toLowerCase().trim();
  const hit = STAGES.find((x) => x.key === (v as StageKey))?.key;
  return (hit ?? "new") as StageKey;
}

function pill(label: string, tone: "gray" | "yellow" | "blue" | "green" | "red" = "gray") {
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

function renderStatusPill(statusRaw: unknown) {
  const s = String(statusRaw ?? "").toLowerCase().trim();
  if (!s) return null;
  if (s === "rendered") return pill("Rendered", "green");
  if (s === "failed") return pill("Render failed", "red");
  if (s === "queued" || s === "running") return pill("Rendering", "blue");
  return pill(s, "gray");
}

type PageProps = {
  params: { id?: string };
};

export default async function QuoteReviewPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const id = String(params?.id ?? "").trim();
  if (!id) {
    // This is the bug you hit: id was undefined.
    // Hard fail safely.
    redirect("/admin/quotes");
  }

  const jar = await cookies();
  let tenantId: string | null = getCookieTenantId(jar);

  if (!tenantId) {
    const t = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.ownerClerkUserId, userId))
      .limit(1)
      .then((r) => r[0] ?? null);

    tenantId = t?.id ?? null;
  }

  if (!tenantId) redirect("/onboarding");

  // Load quote
  const row = await db
    .select({
      id: quoteLogs.id,
      createdAt: quoteLogs.createdAt,
      input: quoteLogs.input,
      stage: quoteLogs.stage,
      isRead: quoteLogs.isRead,
      renderStatus: quoteLogs.renderStatus,
      renderImageUrl: (quoteLogs as any).renderImageUrl,
    })
    .from(quoteLogs)
    .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!row) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="text-lg font-semibold">Quote not found</div>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            This quote doesn’t exist for the active tenant.
          </p>
          <div className="mt-4">
            <Link className="underline" href="/admin/quotes">
              Back to quotes
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Auto-mark read when opened
  let isRead = Boolean(row.isRead);
  if (!isRead) {
    await db
      .update(quoteLogs)
      .set({ isRead: true } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    isRead = true;
  }

  const lead = pickLead(row.input);
  const stage = normalizeStage(row.stage);

  const images: Array<{ url: string }> =
    (row.input?.images && Array.isArray(row.input.images) ? row.input.images : [])
      .filter((x: any) => x?.url)
      .map((x: any) => ({ url: String(x.url) }));

  async function setUnread() {
    "use server";
    await db
      .update(quoteLogs)
      .set({ isRead: false } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    redirect(`/admin/quotes/${id}`);
  }

  async function updateStage(formData: FormData) {
    "use server";
    const nextRaw = String(formData.get("stage") ?? "").toLowerCase().trim();
    const next = STAGES.find((s) => s.key === (nextRaw as StageKey))?.key ?? null;
    if (!next) redirect(`/admin/quotes/${id}`);

    await db
      .update(quoteLogs)
      .set({ stage: next } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));

    redirect(`/admin/quotes/${id}`);
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/admin/quotes" className="text-sm font-semibold text-gray-600 hover:underline dark:text-gray-300">
              ← Back
            </Link>
            <span className="text-gray-300 dark:text-gray-700">/</span>
            <h1 className="text-2xl font-semibold truncate">{lead.name}</h1>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {isRead ? pill("Read", "gray") : pill("Unread", "yellow")}
            {pill(STAGES.find((s) => s.key === stage)?.label ?? stage, stage === "new" ? "blue" : "gray")}
            {renderStatusPill(row.renderStatus)}
          </div>

          <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">
            Submitted: <span className="font-semibold">{fmtDate(String(row.createdAt))}</span>
          </div>

          <div className="mt-2 flex flex-wrap gap-3 text-sm text-gray-700 dark:text-gray-200">
            {lead.phone ? <span className="font-mono">{lead.phone}</span> : null}
            {lead.email ? <span className="font-mono">{lead.email}</span> : null}
            {lead.category ? <span>{pill(lead.category, "blue")}</span> : null}
            {lead.serviceType ? <span>{pill(lead.serviceType, "gray")}</span> : null}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          {/* Only allow toggling back to Unread (since viewing auto-marks Read) */}
          <form action={setUnread}>
            <button
              type="submit"
              className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-2 text-sm font-semibold text-yellow-900 hover:bg-yellow-100 dark:border-yellow-900/50 dark:bg-yellow-950/30 dark:text-yellow-200"
            >
              Mark Unread
            </button>
          </form>

          <Link
            href={`/admin/quotes#q-${id}`}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
          >
            Find in list
          </Link>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: details */}
        <section className="lg:col-span-1 space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
            <div className="text-sm font-semibold">Stage</div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Stages are separate from Read/Unread.
            </p>

            <form action={updateStage} className="mt-3 flex items-center gap-2">
              <select
                name="stage"
                defaultValue={stage}
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
          </div>

          {lead.notes ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
              <div className="text-sm font-semibold">Customer notes</div>
              <div className="mt-3 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-200">
                {lead.notes}
              </div>
            </div>
          ) : null}

          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
            <div className="text-sm font-semibold">Quote ID</div>
            <div className="mt-2 font-mono text-xs text-gray-600 dark:text-gray-300 break-all">{id}</div>
          </div>
        </section>

        {/* Right: images */}
        <section className="lg:col-span-2 space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Photos</div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Click to open full size.
                </div>
              </div>
              <div className="flex items-center gap-2">{images.length ? pill(`${images.length} photo${images.length === 1 ? "" : "s"}`) : pill("No photos")}</div>
            </div>

            {images.length ? (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {images.map((img, idx) => (
                  <a
                    key={img.url + idx}
                    href={img.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-black"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt={`Photo ${idx + 1}`}
                      className="h-40 w-full object-cover transition group-hover:scale-[1.02]"
                      loading="lazy"
                    />
                  </a>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-300">
                No images were submitted for this quote.
              </div>
            )}
          </div>

          {row.renderImageUrl ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
              <div className="text-sm font-semibold">AI Render</div>
              <div className="mt-3 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={String(row.renderImageUrl)} alt="AI render" className="w-full object-cover" />
              </div>
              <div className="mt-3">
                <a
                  href={String(row.renderImageUrl)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-semibold underline text-gray-700 dark:text-gray-200"
                >
                  Open render
                </a>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}