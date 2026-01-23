// src/app/admin/quotes/[id]/page.tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { redirect, notFound } from "next/navigation";

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

// robust params reader (Next can hand you weird shapes sometimes)
function getIdFromParams(params: any): string | null {
  const raw = params?.id;
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return String(raw[0] ?? "") || null;
  return String(raw) || null;
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
    input?.customer_context ??
    input?.lead ??
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

  const notes =
    input?.customer_context?.notes ??
    input?.notes ??
    c?.notes ??
    null;

  const phoneDigits = phone ? digitsOnly(String(phone)) : "";

  return {
    name: String(name || "New customer"),
    phone: phoneDigits ? formatUSPhone(phoneDigits) : null,
    email: email ? String(email) : null,
    notes: notes ? String(notes) : null,
  };
}

// Stages WITHOUT "read"
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

function badge(label: string, tone: "gray" | "blue" | "yellow" | "green" | "red" = "gray") {
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

function safeJsonString(v: any) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v ?? "");
  }
}

type PageProps = {
  params: Promise<{ id: string }> | { id: string };
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
};

export default async function AdminQuoteDetailPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const p = await params;
  const sp = searchParams ? await searchParams : {};
  const skipAutoRead =
    sp.skipAutoRead === "1" || (Array.isArray(sp.skipAutoRead) && sp.skipAutoRead.includes("1"));

  const id = getIdFromParams(p);
  if (!id) {
    // If we don't have an ID, never attempt DB query (prevents undefined params)
    redirect("/admin/quotes");
  }

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
    redirect("/admin/quotes");
  }

  const tenantId = tenantIdMaybe;

  // Load quote
  const q = await db
    .select({
      id: quoteLogs.id,
      createdAt: quoteLogs.createdAt,
      input: quoteLogs.input,
      output: (quoteLogs as any).output, // if exists
      stage: quoteLogs.stage,
      isRead: quoteLogs.isRead,
      renderStatus: quoteLogs.renderStatus,
    })
    .from(quoteLogs)
    .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!q) {
    notFound();
  }

  // Auto-mark read on open (unless user just toggled unread)
  if (!skipAutoRead && !q.isRead) {
    await db
      .update(quoteLogs)
      .set({ isRead: true } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    // refresh state (simple reselect)
    q.isRead = true as any;
  }

  const lead = pickLead(q.input);

  const stageNow = normalizeStage(q.stage);

  async function setUnread() {
    "use server";
    await db
      .update(quoteLogs)
      .set({ isRead: false } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    // prevent auto-read from flipping it back immediately
    redirect(`/admin/quotes/${encodeURIComponent(id)}?skipAutoRead=1`);
  }

  async function setStage(formData: FormData) {
    "use server";
    const next = normalizeStage(String(formData.get("stage") ?? ""));
    await db
      .update(quoteLogs)
      .set({ stage: next } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    redirect(`/admin/quotes/${encodeURIComponent(id)}`);
  }

  // Images submitted by customer
  const submittedImages: string[] =
    (Array.isArray(q.input?.images) ? q.input.images : [])
      .map((x: any) => x?.url)
      .filter(Boolean) ?? [];

  // Attempt to find a rendered image URL somewhere sensible.
  // (you can adapt once you confirm exact field name)
  const renderUrl =
    (q.output as any)?.render_url ??
    (q.output as any)?.renderUrl ??
    (q.input as any)?.render_url ??
    null;

  // AI output (assessment) – show pretty if object
  const ai =
    (q.output as any)?.assessment ??
    (q.output as any)?.ai ??
    (q.output as any) ??
    null;

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
              <div className="text-lg font-semibold">{lead.name}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Submitted {q.createdAt ? new Date(q.createdAt as any).toLocaleString() : "—"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Read status indicator + only allow Unread toggle */}
            {q.isRead ? badge("Read", "gray") : badge("Unread", "yellow")}

            {q.isRead ? (
              <form action={setUnread}>
                <button
                  type="submit"
                  className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm font-semibold text-yellow-900 hover:bg-yellow-100 dark:border-yellow-900/40 dark:bg-yellow-950/20 dark:text-yellow-100 dark:hover:bg-yellow-950/40"
                >
                  Mark Unread
                </button>
              </form>
            ) : null}
          </div>
        </div>

        {/* Lead + stage */}
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950 lg:col-span-1">
            <div className="text-xs font-semibold tracking-wide text-gray-500">Customer</div>

            <div className="mt-3 space-y-2 text-sm">
              {lead.phone ? (
                <div>
                  <div className="text-xs text-gray-500">Phone</div>
                  <div className="font-mono">{lead.phone}</div>
                </div>
              ) : null}

              {lead.email ? (
                <div>
                  <div className="text-xs text-gray-500">Email</div>
                  <div className="font-mono break-all">{lead.email}</div>
                </div>
              ) : null}

              {lead.notes ? (
                <div>
                  <div className="text-xs text-gray-500">Notes</div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-800 dark:bg-black">
                    {lead.notes}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-5">
              <div className="text-xs font-semibold tracking-wide text-gray-500">Stage</div>
              <form action={setStage} className="mt-2 flex items-center gap-2">
                <select
                  name="stage"
                  defaultValue={stageNow}
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

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {badge(`Stage: ${STAGES.find((s) => s.key === stageNow)?.label ?? stageNow}`, "blue")}
                {q.renderStatus ? badge(String(q.renderStatus), q.renderStatus === "rendered" ? "green" : "gray") : null}
              </div>
            </div>
          </div>

          {/* Detail section: AI output then rendering */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950 lg:col-span-2 space-y-4">
            <div>
              <div className="text-xs font-semibold tracking-wide text-gray-500">AI Output</div>
              <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-black">
                <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed">
                  {ai ? safeJsonString(ai) : "No AI output stored for this quote yet."}
                </pre>
              </div>
            </div>

            <div>
              <div className="flex items-end justify-between gap-3">
                <div className="text-xs font-semibold tracking-wide text-gray-500">Rendering</div>
                {q.renderStatus ? (
                  <div className="text-xs text-gray-500 dark:text-gray-400">Status: {String(q.renderStatus)}</div>
                ) : null}
              </div>

              {renderUrl ? (
                <div className="mt-3 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={renderUrl} alt="Rendered result" className="w-full object-cover" />
                </div>
              ) : (
                <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                  No render attached yet.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Photo gallery (submitted photos) */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Submitted photos</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Customer-uploaded images for this quote.
              </p>
            </div>
          </div>

          {submittedImages.length === 0 ? (
            <div className="mt-4 text-sm text-gray-600 dark:text-gray-300">No photos attached.</div>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {submittedImages.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="group overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-black"
                  title="Open full size"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt="Submitted"
                    className="h-36 w-full object-cover transition group-hover:scale-[1.02]"
                  />
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}