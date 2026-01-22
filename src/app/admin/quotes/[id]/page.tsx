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

const STAGES = [
  { key: "new", label: "New" },
  { key: "read", label: "Read" },
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

function badge(label: string, tone: "gray" | "yellow" | "blue" | "green" | "red" = "gray") {
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

function stageBadge(stageRaw: unknown) {
  const st = normalizeStage(stageRaw);
  const label = STAGES.find((s) => s.key === st)?.label ?? "New";
  const tone = st === "new" ? "blue" : st === "won" ? "green" : st === "lost" ? "red" : "gray";
  return badge(label, tone as any);
}

function extractImageUrls(input: any): string[] {
  const urls: string[] = [];

  const add = (u: any) => {
    const s = String(u ?? "").trim();
    if (!s) return;
    if (/^https?:\/\//i.test(s)) urls.push(s);
  };

  // Common shapes we’ve used
  const a = input?.images;
  if (Array.isArray(a)) {
    for (const it of a) add(it?.url ?? it);
  }

  const b = input?.photos;
  if (Array.isArray(b)) {
    for (const it of b) add(it?.url ?? it);
  }

  const c = input?.customer_context?.images;
  if (Array.isArray(c)) {
    for (const it of c) add(it?.url ?? it);
  }

  // de-dupe
  return Array.from(new Set(urls));
}

type PageProps = {
  params: Promise<{ id: string }> | { id: string };
};

export default async function AdminQuoteDetailPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const p = params ? await params : ({} as any);
  const id = String((p as any)?.id ?? "").trim();
  if (!id) redirect("/admin/quotes");

  const jar = await cookies();
  let tenantId: string | null = getCookieTenantId(jar);

  // Fallback: if cookie isn't set, use tenant owned by this user
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
      <div className="mx-auto max-w-6xl px-6 py-10">
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

  // ✅ Make it non-null for Drizzle + server actions
  const tenantIdStrict = tenantId;

  const row = await db
    .select({
      id: quoteLogs.id,
      createdAt: quoteLogs.createdAt,
      input: quoteLogs.input,
      stage: quoteLogs.stage,
      isRead: quoteLogs.isRead,
      renderStatus: quoteLogs.renderStatus,
      renderImageUrl: (quoteLogs as any).renderImageUrl, // tolerate if exists
    })
    .from(quoteLogs)
    .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantIdStrict)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!row) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Quote not found</h1>
          <Link
            href="/admin/quotes"
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
          >
            Back to list
          </Link>
        </div>
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">This quote may have been deleted.</p>
      </div>
    );
  }

  // ✅ Auto-mark read on open (separate from stage)
  if (!row.isRead) {
    await db
      .update(quoteLogs)
      .set({ isRead: true } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantIdStrict)));
    row.isRead = true;
  }

  const lead = pickLead(row.input);
  const images = extractImageUrls(row.input);
  const stage = normalizeStage(row.stage);

  async function setStage(formData: FormData) {
    "use server";
    const next = normalizeStage(formData.get("stage"));
    await db
      .update(quoteLogs)
      .set({ stage: next } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantIdStrict)));
    redirect(`/admin/quotes/${id}`);
  }

  async function setReadState(formData: FormData) {
    "use server";
    const next = String(formData.get("isRead") ?? "") === "1";
    await db
      .update(quoteLogs)
      .set({ isRead: next } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantIdStrict)));
    redirect(`/admin/quotes/${id}`);
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
      {/* Top row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin/quotes"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              ← Back
            </Link>

            {row.isRead ? badge("Read", "gray") : badge("Unread", "yellow")}
            {stageBadge(stage)}
            {row.renderStatus ? badge(String(row.renderStatus), "gray") : null}
          </div>

          <h1 className="mt-4 text-2xl font-semibold truncate">{lead.name}</h1>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            {lead.phone ? <span className="font-mono">{lead.phone}</span> : <span className="italic">No phone</span>}
            {lead.email ? (
              <>
                <span>·</span>
                <span className="font-mono">{lead.email}</span>
              </>
            ) : null}
            <span>·</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Submitted: {row.createdAt ? new Date(row.createdAt as any).toLocaleString() : "—"}
            </span>
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap items-center gap-2">
          <form action={setReadState}>
            <input type="hidden" name="isRead" value="0" />
            <button
              type="submit"
              className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm font-semibold text-yellow-900 hover:bg-yellow-100 dark:border-yellow-900/40 dark:bg-yellow-950/20 dark:text-yellow-200 dark:hover:bg-yellow-950/30"
            >
              Mark unread
            </button>
          </form>

          <form action={setReadState}>
            <input type="hidden" name="isRead" value="1" />
            <button
              type="submit"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Mark read
            </button>
          </form>

          <form action={setStage} className="flex items-center gap-2">
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
              Update stage
            </button>
          </form>
        </div>
      </div>

      {/* Images */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Photos</h2>
          <div className="text-xs text-gray-500 dark:text-gray-400">{images.length} photo(s)</div>
        </div>

        {images.length ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((src) => (
              <a
                key={src}
                href={src}
                target="_blank"
                rel="noreferrer"
                className="group block overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-black"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt="Quote photo"
                  className="h-56 w-full object-cover transition-transform group-hover:scale-[1.02]"
                />
                <div className="px-3 py-2 text-[11px] text-gray-500 truncate">{src}</div>
              </a>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-300">
            No photos found on this quote.
          </div>
        )}
      </div>

      {/* Raw details */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
        <h2 className="text-lg font-semibold">Details</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          This is the raw input we stored for the submission.
        </p>

        <pre className="mt-4 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-200">
          {JSON.stringify(row.input ?? {}, null, 2)}
        </pre>

        <div className="mt-4 font-mono text-[10px] text-gray-400 dark:text-gray-600">Quote ID: {row.id}</div>
      </div>
    </div>
  );
}