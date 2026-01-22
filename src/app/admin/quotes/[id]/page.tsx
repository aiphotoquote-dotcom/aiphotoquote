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

function safeJson(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v ?? "");
  }
}

function pickCustomer(input: any) {
  const ctx = input?.customer_context ?? {};
  const name = ctx?.name ?? input?.name ?? "New customer";
  const email = ctx?.email ?? input?.email ?? null;
  const phoneRaw = ctx?.phone ?? input?.phone ?? null;
  const phone = phoneRaw ? formatUSPhone(String(phoneRaw)) : null;
  const notes = ctx?.notes ?? null;

  return {
    name: String(name || "New customer"),
    email: email ? String(email) : null,
    phone: phone ? String(phone) : null,
    notes: notes ? String(notes) : null,
    category: ctx?.category ? String(ctx.category) : null,
    serviceType: ctx?.service_type ? String(ctx.service_type) : null,
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

// Best-effort AI output picker (no schema assumptions)
function pickAiOutput(input: any) {
  return (
    input?.ai_output ??
    input?.aiOutput ??
    input?.ai_assessment ??
    input?.aiAssessment ??
    input?.assessment ??
    input?.result ??
    input?.output ??
    null
  );
}

// Best-effort render URL picker (no schema assumptions)
function pickRenderUrl(input: any) {
  // common spots
  const direct =
    input?.rendered_url ??
    input?.renderUrl ??
    input?.render_url ??
    input?.render_result?.url ??
    input?.render_result?.image_url ??
    input?.render_result?.imageUrl ??
    input?.render?.url ??
    input?.render?.image_url ??
    input?.render?.imageUrl ??
    null;

  if (direct && typeof direct === "string") return direct;

  // last resort: scan object for a URL that isn't one of the original uploads
  const originals = new Set(
    (input?.images ?? [])
      .map((x: any) => x?.url)
      .filter((u: any) => typeof u === "string") as string[]
  );

  const seen = new Set<any>();
  const stack: any[] = [input];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (seen.has(cur)) continue;
    seen.add(cur);

    for (const v of Object.values(cur as any)) {
      if (typeof v === "string" && v.startsWith("http") && !originals.has(v)) {
        // heuristic: look for typical render-ish filenames/paths
        if (v.includes("render") || v.includes("renders") || v.includes("rendered") || v.includes("output")) return v;
      } else if (v && typeof v === "object") {
        stack.push(v);
      }
    }
  }

  return null;
}

type PageProps = {
  params: Promise<{ id: string }> | { id: string };
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

export default async function QuoteReviewPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const p = await params;
  const id = String(p?.id ?? "").trim();
  if (!id) return notFound();

  const sp = searchParams ? await searchParams : {};
  const skipAutoRead =
    sp.skipAutoRead === "1" || (Array.isArray(sp.skipAutoRead) && sp.skipAutoRead.includes("1"));

  const jar = await cookies();
  let tenantId = getCookieTenantId(jar);

  if (!tenantId) {
    const t = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.ownerClerkUserId, userId))
      .limit(1)
      .then((r) => r[0]?.id ?? null);

    tenantId = t;
  }

  if (!tenantId) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-10">
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

  // Read the quote
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

  if (!row) return notFound();

  // Auto mark read ON OPEN, but never immediately after a manual "mark unread"
  if (!skipAutoRead && row.isRead === false) {
    await db
      .update(quoteLogs)
      .set({ isRead: true } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    // reflect in UI without re-query
    row.isRead = true as any;
  }

  async function setUnread() {
    "use server";
    await db
      .update(quoteLogs)
      .set({ isRead: false } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    // Important: prevent auto-read from flipping it right back
    redirect(`/admin/quotes/${encodeURIComponent(id)}?skipAutoRead=1`);
  }

  async function setRead() {
    "use server";
    await db
      .update(quoteLogs)
      .set({ isRead: true } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    // normal behavior resumes (auto-read is fine)
    redirect(`/admin/quotes/${encodeURIComponent(id)}`);
  }

  async function setStage(formData: FormData) {
    "use server";
    const next = normalizeStage(formData.get("stage"));
    await db
      .update(quoteLogs)
      .set({ stage: next } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    // keep skipAutoRead if you’re currently in unread mode
    const keep = String(formData.get("keepSkip") ?? "") === "1";
    redirect(`/admin/quotes/${encodeURIComponent(id)}${keep ? "?skipAutoRead=1" : ""}`);
  }

  const input = row.input ?? {};
  const cust = pickCustomer(input);
  const stage = normalizeStage(row.stage);
  const stageLabel = STAGES.find((s) => s.key === stage)?.label ?? "New";
  const submitted = row.createdAt ? new Date(row.createdAt).toLocaleString() : "—";

  const ai = pickAiOutput(input);
  const renderUrl = pickRenderUrl(input);
  const images: Array<{ url: string }> = Array.isArray(input?.images) ? input.images : [];

  const isUnread = row.isRead === false;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
      {/* Top */}
      <div className="flex items-center justify-between gap-3">
        <Link href="/admin/quotes" className="text-sm font-semibold text-gray-600 hover:underline dark:text-gray-300">
          ← Back to quotes
        </Link>
      </div>

      {/* Header */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold">Quote review</h1>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">Submitted {submitted}</div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {isUnread ? chip("Unread", "yellow") : chip("Read", "gray")}
              {chip(stageLabel, stage === "new" ? "blue" : stage === "quoted" ? "green" : "gray")}
              {input?.render_opt_in ? chip("Render requested", "blue") : chip("Render not requested", "gray")}
              {row.renderStatus ? chip(String(row.renderStatus), row.renderStatus === "rendered" ? "green" : "gray") : null}
            </div>
          </div>

          {/* Read toggle (no circular logic) */}
          <div className="flex items-center gap-2">
            {isUnread ? (
              <form action={setRead}>
                <button
                  type="submit"
                  className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                >
                  Mark read
                </button>
              </form>
            ) : (
              <form action={setUnread}>
                <button
                  type="submit"
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                >
                  Mark unread
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Customer / Stage */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
          <div className="text-xs font-semibold tracking-wide text-gray-500">CUSTOMER</div>
          <div className="mt-3 text-2xl font-semibold">{cust.name}</div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-black">
              <div className="text-[11px] font-semibold text-gray-500">PHONE</div>
              <div className="mt-1 font-mono text-sm">{cust.phone || <span className="italic text-gray-500">—</span>}</div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-black">
              <div className="text-[11px] font-semibold text-gray-500">EMAIL</div>
              <div className="mt-1 font-mono text-sm break-all">
                {cust.email || <span className="italic text-gray-500">—</span>}
              </div>
            </div>
          </div>

          {/* Customer notes */}
          <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
            <div className="text-[11px] font-semibold text-gray-500">CUSTOMER NOTES</div>
            <div className="mt-2 text-sm text-gray-800 dark:text-gray-200">
              {cust.notes ? cust.notes : <span className="italic text-gray-500">No notes provided.</span>}
            </div>
          </div>

          {/* Meta */}
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-gray-500">
            {cust.category ? <span className="rounded-full border border-gray-200 px-2 py-1 dark:border-gray-800">{cust.category}</span> : null}
            {cust.serviceType ? <span className="rounded-full border border-gray-200 px-2 py-1 dark:border-gray-800">{cust.serviceType}</span> : null}
            {input?.tenantSlug ? <span className="rounded-full border border-gray-200 px-2 py-1 dark:border-gray-800">{String(input.tenantSlug)}</span> : null}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
          <div className="text-xs font-semibold tracking-wide text-gray-500">STAGE</div>
          <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Stage is separate from read/unread.
          </div>

          <form action={setStage} className="mt-4 flex items-center gap-3">
            {/* Preserve skipAutoRead state when currently unread */}
            <input type="hidden" name="keepSkip" value={isUnread ? "1" : "0"} />

            <select
              name="stage"
              defaultValue={stage}
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold dark:border-gray-800 dark:bg-black"
            >
              {STAGES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>

            <button
              type="submit"
              className="rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
            >
              Save
            </button>
          </form>
        </div>
      </div>

      {/* DETAILS (AI output first, render below if any) */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Details</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">AI output first. Render below if available.</p>
          </div>
        </div>

        {/* AI output */}
        <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black">
          <div className="text-xs font-semibold tracking-wide text-gray-500">AI OUTPUT</div>

          {ai ? (
            <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-white p-4 text-[12px] leading-relaxed dark:border-gray-800 dark:bg-gray-950">
              {safeJson(ai)}
            </pre>
          ) : (
            <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">
              AI output isn’t present on this record yet. (Once you confirm where it’s stored, we can display it with nicer formatting.)
            </div>
          )}
        </div>

        {/* Render result */}
        {renderUrl ? (
          <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
            <div className="text-xs font-semibold tracking-wide text-gray-500">RENDER RESULT</div>
            <div className="mt-3 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={renderUrl} alt="Rendered result" className="h-auto w-full object-cover" />
            </div>
            <div className="mt-2 text-xs text-gray-500 break-all">{renderUrl}</div>
          </div>
        ) : null}
      </div>

      {/* Original photos */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Photos</h2>
          <div className="text-sm text-gray-500">{images.length} total</div>
        </div>

        {images.length === 0 ? (
          <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">No photos attached.</div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {images.map((im: any, idx: number) => (
              <a
                key={`${im?.url ?? idx}`}
                href={String(im?.url)}
                target="_blank"
                rel="noreferrer"
                className="group overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-black"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={String(im?.url)}
                  alt={`Upload ${idx + 1}`}
                  className="h-64 w-full object-cover transition group-hover:scale-[1.01]"
                />
                <div className="p-3 text-xs text-gray-500 break-all">{String(im?.url)}</div>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Raw payload (keep for debugging) */}
      <details className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <summary className="cursor-pointer text-sm font-semibold text-gray-700 dark:text-gray-200">
          Raw submission payload
        </summary>
        <pre className="mt-4 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-[12px] dark:border-gray-800 dark:bg-black">
          {safeJson(input)}
        </pre>
      </details>
    </div>
  );
}