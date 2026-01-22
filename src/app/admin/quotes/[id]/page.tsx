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
    input?.customer_context ??
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

  const notes =
    c?.notes ??
    input?.notes ??
    input?.customer_context?.notes ??
    input?.customer_context?.customer?.notes ??
    null;

  const phoneDigits = phone ? digitsOnly(String(phone)) : "";

  return {
    name: String(name || "New customer"),
    phone: phoneDigits ? formatUSPhone(phoneDigits) : null,
    phoneDigits: phoneDigits || null,
    email: email ? String(email) : null,
    notes: notes ? String(notes) : null,
  };
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

function normalizeStage(s: unknown): StageKey {
  const v = String(s ?? "").toLowerCase().trim();
  const hit = STAGES.find((x) => x.key === v)?.key;
  return (hit ?? "new") as StageKey;
}

function badge(label: string, tone: "gray" | "yellow" | "blue" | "green" | "red" = "gray") {
  const cls =
    tone === "yellow"
      ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/30 dark:text-yellow-200"
      : tone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200"
      : tone === "green"
      ? "border-green-200 bg-green-50 text-green-900 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-200"
      : tone === "red"
      ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
      : "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200";

  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold", cls)}>
      {label}
    </span>
  );
}

function renderStatusBadge(renderStatusRaw: unknown) {
  const s = String(renderStatusRaw ?? "").toLowerCase().trim();
  if (!s) return null;
  if (s === "rendered") return badge("Rendered", "green");
  if (s === "failed") return badge("Render failed", "red");
  if (s === "queued" || s === "running") return badge(s === "queued" ? "Queued" : "Rendering…", "blue");
  return badge(s, "gray");
}

function extractRenderImageUrl(row: any, input: any) {
  // Try common places without assuming schema
  return (
    row?.renderImageUrl ??
    row?.render_image_url ??
    row?.renderUrl ??
    row?.render_url ??
    input?.render_image_url ??
    input?.renderImageUrl ??
    input?.render?.imageUrl ??
    input?.render?.image_url ??
    null
  );
}

function extractAiOutput(row: any, input: any) {
  // Try common column names or embedded output fields
  const candidates = [
    row?.output,
    row?.aiOutput,
    row?.ai_output,
    row?.assessment,
    row?.aiAssessment,
    row?.ai_assessment,
    input?.ai,
    input?.assessment,
    input?.ai_assessment,
    input?.ai_output,
  ];
  for (const c of candidates) {
    if (c && typeof c === "object") return c;
    if (typeof c === "string") {
      // if it is JSON text, parse safely
      try {
        const parsed = JSON.parse(c);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {}
    }
  }
  return null;
}

async function trySelectQuote(tenantIdSafe: string, id: string) {
  // Primary: typed selection (safe)
  const base = await db
    .select({
      id: quoteLogs.id,
      createdAt: quoteLogs.createdAt,
      input: quoteLogs.input,
      stage: quoteLogs.stage,
      isRead: quoteLogs.isRead,
      renderStatus: quoteLogs.renderStatus,
      tenantId: quoteLogs.tenantId,
    })
    .from(quoteLogs)
    .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantIdSafe)))
    .limit(1)
    .then((r) => r[0] ?? null);

  return base;
}

type PageProps = {
  params: Promise<{ id: string }> | { id: string };
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

export default async function AdminQuoteDetailPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const p = await params;
  const id = String(p?.id ?? "").trim();
  if (!id) notFound();

  const sp = searchParams ? await searchParams : {};
  const skipAutoRead =
    sp.skipAutoRead === "1" || (Array.isArray(sp.skipAutoRead) && sp.skipAutoRead.includes("1"));

  const jar = await cookies();
  let tenantId = getCookieTenantId(jar);

  // fallback: tenant owned by user
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
          <h1 className="text-2xl font-semibold">Quote</h1>
          <div className="mt-6 rounded-2xl border border-yellow-200 bg-yellow-50 p-5 text-sm text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
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

  // ✅ critical: capture as non-null const for actions & where clauses
  const tenantIdSafe = tenantId;

  // Load the quote
  const q = await trySelectQuote(tenantIdSafe, id);
  if (!q) notFound();

  // Parse input safely
  const inputObj = (() => {
    try {
      return typeof q.input === "string" ? JSON.parse(q.input) : q.input;
    } catch {
      return q.input;
    }
  })();

  const lead = pickLead(inputObj);

  // Auto-mark read on open (unless we’re intentionally skipping it after toggles)
  if (!skipAutoRead && q.isRead === false) {
    await db
      .update(quoteLogs)
      .set({ isRead: true } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantIdSafe)));
    // refresh local view state
    q.isRead = true as any;
  }

  const currentStage = normalizeStage(q.stage);
  const aiOut = extractAiOutput(q as any, inputObj);
  const renderImageUrl = extractRenderImageUrl(q as any, inputObj);
  const renderBadge = renderStatusBadge(q.renderStatus);

  async function toggleRead(formData: FormData) {
    "use server";
    const next = String(formData.get("next") ?? "").trim();
    const toUnread = next === "unread";

    await db
      .update(quoteLogs)
      .set({ isRead: toUnread ? false : true } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantIdSafe)));

    // Important: keep user on detail page, and prevent auto-read from immediately flipping unread back to read.
    redirect(`/admin/quotes/${encodeURIComponent(id)}?skipAutoRead=1`);
  }

  async function updateStage(formData: FormData) {
    "use server";
    const nextRaw = String(formData.get("stage") ?? "").trim();
    const next = normalizeStage(nextRaw);

    await db
      .update(quoteLogs)
      .set({ stage: next } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantIdSafe)));

    redirect(`/admin/quotes/${encodeURIComponent(id)}?skipAutoRead=1`);
  }

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        {/* Top row */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/admin/quotes"
                className="text-sm font-semibold text-gray-600 hover:underline dark:text-gray-300"
              >
                ← Back to Quotes
              </Link>
              <span className="text-gray-300 dark:text-gray-700">/</span>
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Review</span>
            </div>

            <h1 className="mt-3 text-2xl font-semibold truncate">{lead.name}</h1>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {q.isRead ? badge("Read", "gray") : badge("Unread", "yellow")}
              {badge(STAGES.find((s) => s.key === currentStage)?.label ?? "New", "blue")}
              {renderBadge}
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-sm text-gray-600 dark:text-gray-300">
              {lead.phone ? <span className="font-mono">{lead.phone}</span> : <span className="italic">No phone</span>}
              {lead.email ? (
                <>
                  <span>·</span>
                  <span className="font-mono">{lead.email}</span>
                </>
              ) : null}
              <span>·</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {q.createdAt ? new Date(q.createdAt as any).toLocaleString() : "—"}
              </span>
            </div>
          </div>

          {/* Controls */}
          <div className="w-full sm:w-auto">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-950">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">Actions</div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {/* Read toggle */}
                <form action={toggleRead}>
                  <input type="hidden" name="next" value={q.isRead ? "unread" : "read"} />
                  <button
                    type="submit"
                    className={cn(
                      "rounded-lg px-3 py-2 text-sm font-semibold transition",
                      q.isRead
                        ? "border border-yellow-200 bg-yellow-50 text-yellow-900 hover:bg-yellow-100 dark:border-yellow-900/50 dark:bg-yellow-950/30 dark:text-yellow-200 dark:hover:bg-yellow-950/50"
                        : "border border-gray-200 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-200 dark:hover:bg-gray-900"
                    )}
                  >
                    {q.isRead ? "Mark unread" : "Mark read"}
                  </button>
                </form>

                {/* Stage selector */}
                <form action={updateStage} className="flex items-center gap-2">
                  <select
                    name="stage"
                    defaultValue={currentStage}
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
                    className="rounded-lg bg-black px-3 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                  >
                    Save
                  </button>
                </form>
              </div>

              {lead.notes ? (
                <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-200">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">Customer notes</div>
                  <div className="mt-1">{lead.notes}</div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* DETAIL SECTION (per your clarification): AI output first */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">AI output</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Assessment + estimate payload captured for this submission.
              </p>
            </div>
          </div>

          {aiOut ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
              <pre className="max-h-[520px] overflow-auto bg-gray-50 p-4 text-[12px] leading-relaxed text-gray-900 dark:bg-black dark:text-gray-100">
{JSON.stringify(aiOut, null, 2)}
              </pre>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-300">
              No structured AI output found on this quote yet.
            </div>
          )}

          {/* input images quick view */}
          {Array.isArray(inputObj?.images) && inputObj.images.length ? (
            <div className="mt-5">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">Submitted photos</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {inputObj.images
                  .map((x: any) => x?.url)
                  .filter(Boolean)
                  .slice(0, 12)
                  .map((url: string) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="group overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-black"
                      title="Open image"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt="Submitted"
                        className="h-44 w-full object-cover transition group-hover:scale-[1.02]"
                      />
                    </a>
                  ))}
              </div>
            </div>
          ) : null}
        </section>

        {/* Rendering section below (only if a render happened OR we have an image URL) */}
        {String(q.renderStatus ?? "").toLowerCase() === "rendered" || renderImageUrl ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Rendering</h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  Final visual output (if generated).
                </p>
              </div>
              {renderStatusBadge(q.renderStatus)}
            </div>

            {renderImageUrl ? (
              <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={renderImageUrl}
                  alt="Rendered output"
                  className="w-full object-contain bg-white dark:bg-black"
                />
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-300">
                Render is marked as rendered, but no render image URL was found.
              </div>
            )}
          </section>
        ) : null}

        {/* Footer helper (no quote id shown) */}
        <div className="text-xs text-gray-500 dark:text-gray-600">
          Tip: marking unread won’t flip back to read unless you reopen without the skip flag.
        </div>
      </div>
    </main>
  );
}