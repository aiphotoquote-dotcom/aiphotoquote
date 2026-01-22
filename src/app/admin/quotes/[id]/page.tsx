// src/app/admin/quotes/[id]/page.tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

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
    email: email ? String(email) : null,
  };
}

const STAGES = [
  { key: "new", label: "New" },
  { key: "estimate", label: "Estimate" },
  { key: "contacted", label: "Contacted" },
  { key: "scheduled", label: "Scheduled" },
  { key: "quoted", label: "Quoted" },
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
      : "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200";
  return <span className={cn(base, cls)}>{label}</span>;
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export default async function AdminQuoteDetailPage(props: {
  params: { id: string } | Promise<{ id: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Next can hand params as a Promise depending on compilation mode — handle both.
  const p: any = (props as any).params;
  const params = typeof p?.then === "function" ? await p : p;

  const idRaw = params?.id ? String(params.id) : "";
  const id = decodeURIComponent(idRaw || "").trim();

  if (!id || !isUuid(id)) notFound();

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

  if (!tenantIdMaybe) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6">
          <Link href="/admin/quotes" className="text-sm font-semibold underline text-gray-600 dark:text-gray-300">
            ← Back to Quotes
          </Link>
        </div>

        <h1 className="text-2xl font-semibold">Quote</h1>
        <div className="mt-6 rounded-2xl border border-yellow-200 bg-yellow-50 p-5 text-sm text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
          No active tenant selected. Go to{" "}
          <Link className="underline" href="/onboarding">
            Settings
          </Link>{" "}
          and make sure your tenant is created/selected.
        </div>
      </div>
    );
  }

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

  if (!row) notFound();

  // Auto-mark read when opened (no redirect)
  if (!row.isRead) {
    await db
      .update(quoteLogs)
      .set({ isRead: true } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    row.isRead = true;
  }

  const lead = pickLead(row.input);
  const stage = normalizeStage(row.stage);

  async function setStage(formData: FormData) {
    "use server";
    const next = normalizeStage(formData.get("stage"));
    await db
      .update(quoteLogs)
      .set({ stage: next } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    redirect(`/admin/quotes/${encodeURIComponent(id)}`);
  }

  async function markUnread() {
    "use server";
    await db
      .update(quoteLogs)
      .set({ isRead: false } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    redirect(`/admin/quotes/${encodeURIComponent(id)}`);
  }

  // images (best-effort)
  const images: Array<{ url: string }> =
    (row.input?.images && Array.isArray(row.input.images) ? row.input.images : []) ||
    (row.input?.photos && Array.isArray(row.input.photos) ? row.input.photos : []);

  const createdLabel = row.createdAt ? new Date(row.createdAt).toLocaleString() : "—";

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
      {/* Top row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/admin/quotes" className="text-sm font-semibold underline text-gray-600 dark:text-gray-300">
          ← Back to Quotes
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          {row.isRead ? chip("Read", "gray") : chip("Unread", "yellow")}
          {chip(`Stage: ${STAGES.find((s) => s.key === stage)?.label ?? stage}`, "blue")}
          {row.renderStatus ? chip(`Render: ${String(row.renderStatus)}`, row.renderStatus === "rendered" ? "green" : "gray") : null}
        </div>
      </div>

      {/* Header card */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">{lead.name}</h1>
            <div className="mt-2 flex flex-wrap gap-2 text-sm text-gray-600 dark:text-gray-300">
              {lead.phone ? <span className="font-mono">{lead.phone}</span> : <span className="italic">No phone</span>}
              {lead.email ? (
                <>
                  <span>·</span>
                  <span className="font-mono">{lead.email}</span>
                </>
              ) : null}
            </div>
            <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">Submitted: {createdLabel}</div>
            <div className="mt-2 text-[10px] font-mono text-gray-400 dark:text-gray-600">{row.id}</div>
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            {/* Stage */}
            <form action={setStage} className="flex items-center gap-2">
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">Stage</label>
              <select
                name="stage"
                defaultValue={stage}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
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

            {/* Read/unread (separate) */}
            <form action={markUnread}>
              <button
                type="submit"
                disabled={!row.isRead}
                className={cn(
                  "rounded-lg border px-4 py-2 text-sm font-semibold",
                  row.isRead
                    ? "border-yellow-200 bg-yellow-50 text-yellow-900 hover:bg-yellow-100 dark:border-yellow-900/50 dark:bg-yellow-950/20 dark:text-yellow-200 dark:hover:bg-yellow-950/40"
                    : "border-gray-200 bg-white text-gray-400 opacity-60 cursor-not-allowed dark:border-gray-800 dark:bg-black dark:text-gray-600"
                )}
                title={row.isRead ? "Mark as unread" : "Already unread"}
              >
                Mark Unread
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Photos */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Photos</h2>
          <div className="text-sm text-gray-600 dark:text-gray-300">{images.length} files</div>
        </div>

        {images.length === 0 ? (
          <div className="mt-4 text-sm text-gray-600 dark:text-gray-300">No images found on this quote.</div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((img, idx) => {
              const url = String((img as any)?.url ?? "");
              if (!url) return null;
              return (
                <a
                  key={`${url}-${idx}`}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="group overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-black"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`Photo ${idx + 1}`}
                    className="h-56 w-full object-cover transition group-hover:scale-[1.01]"
                  />
                </a>
              );
            })}
          </div>
        )}
      </div>

      {/* Raw input (for now) */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <h2 className="text-lg font-semibold">Details</h2>
        <div className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs dark:border-gray-800 dark:bg-black">
          <pre className="whitespace-pre-wrap break-words text-gray-800 dark:text-gray-200">
            {JSON.stringify(row.input ?? {}, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}