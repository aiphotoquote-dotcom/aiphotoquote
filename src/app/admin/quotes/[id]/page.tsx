// src/app/admin/quotes/[id]/page.tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { quoteLogs, tenants } from "@/lib/db/schema";

export const runtime = "nodejs";

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
  { key: "read", label: "Read" },
  { key: "estimate", label: "Estimate" },
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

function pill(label: string, tone: "gray" | "blue" | "yellow" | "green" | "red" = "gray") {
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

function getCookieTenantId(jar: Awaited<ReturnType<typeof cookies>>) {
  const candidates = [
    jar.get("activeTenantId")?.value,
    jar.get("active_tenant_id")?.value,
    jar.get("tenantId")?.value,
    jar.get("tenant_id")?.value,
  ].filter(Boolean) as string[];

  return candidates[0] || null;
}

function safeDate(iso: any) {
  const d = new Date(String(iso ?? ""));
  return Number.isNaN(d.getTime()) ? String(iso ?? "—") : d.toLocaleString();
}

function extractImages(input: any): string[] {
  const imgs: any[] =
    input?.images ??
    input?.photos ??
    input?.customer_context?.images ??
    input?.customer_context?.photos ??
    [];
  const urls = imgs
    .map((x) => (typeof x === "string" ? x : x?.url))
    .filter(Boolean)
    .map(String);
  return Array.from(new Set(urls));
}

type PageProps = { params: Promise<{ id: string }> | { id: string } };

export default async function AdminQuoteDetailPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const p = await params;
  const id = p.id;

  const jar = await cookies();
  let tenantId = getCookieTenantId(jar);

  // Fallback: tenant owned by user
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
        <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-5 text-sm text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
          No active tenant selected. Go to{" "}
          <Link className="underline" href="/onboarding">
            Settings
          </Link>{" "}
          and make sure your tenant is created/selected.
        </div>
      </div>
    );
  }

  const row = await db
    .select({
      id: quoteLogs.id,
      createdAt: quoteLogs.createdAt,
      input: quoteLogs.input,
      stage: quoteLogs.stage,
      isRead: quoteLogs.isRead,
      renderStatus: quoteLogs.renderStatus,
      renderImageUrl: (quoteLogs as any).renderImageUrl, // tolerate older schema
      estimateLow: (quoteLogs as any).estimateLow,
      estimateHigh: (quoteLogs as any).estimateHigh,
    })
    .from(quoteLogs)
    .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!row) notFound();

  // ✅ Auto-mark Read on open (separate from stage)
  if (!row.isRead) {
    await db
      .update(quoteLogs)
      .set({ isRead: true } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    row.isRead = true;
  }

  const lead = pickLead(row.input);
  const stage = normalizeStage(row.stage);
  const images = extractImages(row.input);

  async function setStage(formData: FormData) {
    "use server";
    const next = normalizeStage(formData.get("stage"));
    await db
      .update(quoteLogs)
      .set({ stage: next } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    redirect(`/admin/quotes/${id}`);
  }

  async function setReadState(formData: FormData) {
    "use server";
    const next = String(formData.get("isRead") ?? "") === "1";
    await db
      .update(quoteLogs)
      .set({ isRead: next } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    redirect(`/admin/quotes/${id}`);
  }

  const estLow = row.estimateLow != null ? Number(row.estimateLow) : null;
  const estHigh = row.estimateHigh != null ? Number(row.estimateHigh) : null;
  const estLabel =
    estLow != null || estHigh != null
      ? `${estLow != null ? `$${estLow.toLocaleString()}` : ""}${
          estHigh != null ? ` – $${estHigh.toLocaleString()}` : ""
        }`
      : null;

  const renderStatus = String(row.renderStatus ?? "").toLowerCase();
  const renderPill =
    renderStatus === "rendered"
      ? pill("Rendered", "green")
      : renderStatus === "failed"
      ? pill("Render failed", "red")
      : renderStatus === "queued" || renderStatus === "running"
      ? pill("Rendering…", "blue")
      : renderStatus
      ? pill(renderStatus, "gray")
      : null;

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
              ← Back to Quotes
            </Link>

            <div className="flex flex-wrap items-center gap-2">
              {row.isRead ? pill("Read", "gray") : pill("Unread", "yellow")}
              {pill(`Stage: ${STAGES.find((s) => s.key === stage)?.label ?? stage}`, "blue")}
              {renderPill}
              {estLabel ? pill(estLabel, "green") : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Read/Unread toggle (separate from stage) */}
            <form action={setReadState} className="flex items-center gap-2">
              <input type="hidden" name="isRead" value={row.isRead ? "0" : "1"} />
              <button
                type="submit"
                className={cn(
                  "rounded-lg px-3 py-2 text-sm font-semibold",
                  row.isRead
                    ? "border border-yellow-200 bg-yellow-50 text-yellow-900 hover:bg-yellow-100 dark:border-yellow-900/50 dark:bg-yellow-950/30 dark:text-yellow-200"
                    : "border border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                )}
              >
                Mark {row.isRead ? "Unread" : "Read"}
              </button>
            </form>

            {/* Stage selector */}
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
                Save
              </button>
            </form>
          </div>
        </div>

        {/* Header card */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold">{lead.name}</h1>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <span>Submitted: <b className="text-gray-900 dark:text-gray-100">{safeDate(row.createdAt)}</b></span>
                <span>·</span>
                <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{row.id}</span>
              </div>

              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                {lead.phone ? (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-black">
                    <div className="text-xs text-gray-500">Phone</div>
                    <div className="font-mono">{lead.phone}</div>
                  </div>
                ) : null}

                {lead.email ? (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-black">
                    <div className="text-xs text-gray-500">Email</div>
                    <div className="font-mono">{lead.email}</div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/admin/quotes?stage=${stage}`}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
              >
                See all “{STAGES.find((s) => s.key === stage)?.label ?? stage}”
              </Link>
              <Link
                href={`/admin/quotes?unread=1`}
                className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm font-semibold text-yellow-900 hover:bg-yellow-100 dark:border-yellow-900/50 dark:bg-yellow-950/30 dark:text-yellow-200"
              >
                Unread queue
              </Link>
            </div>
          </div>
        </section>

        {/* Body grid */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Photos */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Photos</h2>
              <span className="text-sm text-gray-600 dark:text-gray-300">{images.length} image(s)</span>
            </div>

            {images.length ? (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {images.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="group block overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-black"
                    title="Open image"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt="Quote photo"
                      className="h-40 w-full object-cover transition-transform group-hover:scale-[1.02]"
                      loading="lazy"
                    />
                  </a>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-300">
                No photos found in input payload.
              </div>
            )}

            {/* Render preview (if present) */}
            {row.renderImageUrl ? (
              <div className="mt-6">
                <h3 className="text-sm font-semibold">Render output</h3>
                <div className="mt-2 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={String(row.renderImageUrl)} alt="Render" className="w-full object-cover" />
                </div>
              </div>
            ) : null}
          </section>

          {/* Summary / Notes */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950 lg:col-span-1">
            <h2 className="text-lg font-semibold">Details</h2>

            <div className="mt-4 space-y-3 text-sm">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
                <div className="text-xs text-gray-500">Read status</div>
                <div className="mt-1">{row.isRead ? "Read" : "Unread"}</div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
                <div className="text-xs text-gray-500">Stage</div>
                <div className="mt-1">{STAGES.find((s) => s.key === stage)?.label ?? stage}</div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
                <div className="text-xs text-gray-500">Render status</div>
                <div className="mt-1">{renderStatus ? renderStatus : "—"}</div>
              </div>

              <details className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
                <summary className="cursor-pointer text-sm font-semibold">Raw input JSON</summary>
                <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-white p-3 text-xs text-gray-700 dark:bg-black dark:text-gray-200">
{JSON.stringify(row.input ?? {}, null, 2)}
                </pre>
              </details>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}