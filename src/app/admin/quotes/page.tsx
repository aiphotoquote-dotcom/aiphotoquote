// src/app/admin/quotes/page.tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { quoteLogs, tenants } from "@/lib/db/schema";

export const runtime = "nodejs";

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

function stageChip(stageRaw: unknown) {
  const st = normalizeStage(stageRaw);
  const label = STAGES.find((s) => s.key === st)?.label ?? "New";
  return (
    <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200">
      {label}
    </span>
  );
}

function renderChip(renderStatusRaw: unknown) {
  const s = String(renderStatusRaw ?? "").toLowerCase().trim();
  if (!s) return null;

  if (s === "rendered")
    return (
      <span className="rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-[11px] font-semibold text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200">
        Rendered
      </span>
    );

  if (s === "failed")
    return (
      <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
        Render failed
      </span>
    );

  if (s === "queued" || s === "running")
    return (
      <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-semibold text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
        {s === "queued" ? "Queued" : "Rendering…"}
      </span>
    );

  return (
    <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-semibold text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
      {s}
    </span>
  );
}

function clampInt(v: unknown, fallback: number, min: number, max: number) {
  const n = Number(Array.isArray(v) ? v[0] : v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function qs(params: Record<string, string | number | null | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

type PageProps = {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

function TopNav({ active }: { active: "dashboard" | "quotes" | "settings" }) {
  const linkClass = (isActive: boolean) =>
    "rounded-lg px-3 py-2 text-sm font-semibold " +
    (isActive
      ? "bg-black text-white dark:bg-white dark:text-black"
      : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-900");

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/80 backdrop-blur dark:border-gray-800 dark:bg-black/70">
      <div className="mx-auto max-w-6xl px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-black dark:bg-white" />
          <div className="leading-tight">
            <div className="text-sm font-semibold">AI Photo Quote</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Admin</div>
          </div>
        </div>

        <nav className="flex items-center gap-2">
          <Link href="/admin" className={linkClass(active === "dashboard")}>
            Dashboard
          </Link>
          <Link href="/admin/quotes" className={linkClass(active === "quotes")}>
            Quotes
          </Link>
          <Link href="/onboarding" className={linkClass(active === "settings")}>
            Settings
          </Link>
        </nav>
      </div>
    </header>
  );
}

export default async function AdminQuotesPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <TopNav active="quotes" />
        <div className="mx-auto max-w-6xl px-6 py-10">
          <h1 className="text-2xl font-semibold">Quotes</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">You must be signed in.</p>
          <div className="mt-6">
            <Link className="underline" href="/sign-in">
              Sign in
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const sp = searchParams ? await searchParams : {};

  // ---------- Canonical filter: view=unread|new|in_progress ----------
  const viewRaw = Array.isArray((sp as any).view) ? (sp as any).view[0] : (sp as any).view;
  const view = String(viewRaw ?? "").toLowerCase().trim();

  // ---------- Legacy filter support (do NOT break old links) ----------
  const legacyUnread =
    (sp as any).unread === "1" || (Array.isArray((sp as any).unread) && (sp as any).unread.includes("1"));

  const legacyInProgress =
    (sp as any).in_progress === "1" ||
    (Array.isArray((sp as any).in_progress) && (sp as any).in_progress.includes("1"));

  const stageParamRaw = Array.isArray((sp as any).stage) ? (sp as any).stage[0] : (sp as any).stage;
  const legacyStage = stageParamRaw ? normalizeStage(stageParamRaw) : null;

  // Determine effective filters from canonical view (preferred), else legacy
  const unreadOnly = view === "unread" ? true : legacyUnread;
  const inProgressOnly = view === "in_progress" ? true : legacyInProgress;
  const stageParam: StageKey | null =
    view === "new" ? "new" : legacyStage;

  // pagination
  const page = clampInt((sp as any).page, 1, 1, 10_000);
  const pageSize = clampInt((sp as any).pageSize, 25, 5, 200);
  const offset = (page - 1) * pageSize;

  // delete confirm UI
  const deleteIdRaw = (sp as any)?.deleteId;
  const confirmDeleteRaw = (sp as any)?.confirmDelete;

  const deleteId = Array.isArray(deleteIdRaw) ? String(deleteIdRaw[0] ?? "") : String(deleteIdRaw ?? "");
  const confirmDelete =
    confirmDeleteRaw === "1" || (Array.isArray(confirmDeleteRaw) && confirmDeleteRaw.includes("1"));

  const jar = await cookies();
  let tenantIdMaybe = getCookieTenantId(jar);

  // Fallback: if cookie isn't set, use tenant owned by this user
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
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <TopNav active="quotes" />
        <div className="mx-auto max-w-6xl px-6 py-10">
          <h1 className="text-2xl font-semibold">Quotes</h1>
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

  const tenantId = tenantIdMaybe;

  // Build WHERE filters for BOTH count + rows
  const whereParts: any[] = [eq(quoteLogs.tenantId, tenantId)];

  if (unreadOnly) whereParts.push(eq(quoteLogs.isRead, false));

  if (inProgressOnly) {
    // per your rule: ONLY read / estimate / quoted
    whereParts.push(inArray(quoteLogs.stage, ["read", "estimate", "quoted"]));
  }

  if (stageParam) whereParts.push(eq(quoteLogs.stage, stageParam));

  const whereAll = and(...whereParts);

  const hasFilters = unreadOnly || inProgressOnly || Boolean(stageParam);

  // Canonical query params for navigation/paging: use view when possible
  const canonicalView =
    unreadOnly ? "unread" : inProgressOnly ? "in_progress" : stageParam === "new" ? "new" : null;

  const filterParams = {
    view: canonicalView,
    // keep stage param only if user explicitly used it (or if not represented by view)
    stage: canonicalView ? null : stageParam,
  };

  async function deleteLead(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "").trim();
    if (!id) return;

    await db.delete(quoteLogs).where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    redirect(`/admin/quotes${qs({ ...filterParams, page, pageSize })}`);
  }

  // total count for paging controls (WITH filters)
  const totalCount = await db
    .select({ c: sql<number>`count(*)` })
    .from(quoteLogs)
    .where(whereAll)
    .then((r) => Number(r?.[0]?.c ?? 0));

  const rows = await db
    .select({
      id: quoteLogs.id,
      createdAt: quoteLogs.createdAt,
      input: quoteLogs.input,
      renderStatus: quoteLogs.renderStatus,
      isRead: quoteLogs.isRead,
      stage: quoteLogs.stage,
    })
    .from(quoteLogs)
    .where(whereAll)
    .orderBy(desc(quoteLogs.createdAt))
    .limit(pageSize)
    .offset(offset);

  const unreadCountOnPage = rows.reduce((acc, r) => acc + (r.isRead ? 0 : 1), 0);

  const totalPages = Math.max(1, Math.ceil(Number(totalCount) / pageSize));
  const safePage = Math.min(page, totalPages);

  const prevPage = safePage > 1 ? safePage - 1 : null;
  const nextPage = safePage < totalPages ? safePage + 1 : null;

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <TopNav active="quotes" />

      <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Quotes</h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              {totalCount} total{hasFilters ? " (filtered)" : ""} · {unreadCountOnPage} unread on this page · Page{" "}
              {safePage} / {totalPages}
            </p>

            {hasFilters ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-gray-600 dark:text-gray-300">Active filters:</span>

                {unreadOnly ? (
                  <span className="rounded-full border border-yellow-200 bg-yellow-50 px-2.5 py-1 font-semibold text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
                    Unread
                  </span>
                ) : null}

                {inProgressOnly ? (
                  <span className="rounded-full border border-green-200 bg-green-50 px-2.5 py-1 font-semibold text-green-900 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200">
                    In progress (read/estimate/quoted)
                  </span>
                ) : null}

                {stageParam && !canonicalView ? (
                  <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-semibold text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200">
                    Stage: {STAGES.find((s) => s.key === stageParam)?.label ?? stageParam}
                  </span>
                ) : null}

                <Link href="/admin/quotes" className="ml-1 underline text-gray-600 dark:text-gray-300">
                  Clear
                </Link>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/onboarding"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Settings
            </Link>
          </div>
        </div>

        {/* Paging controls */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link
              href={`/admin/quotes${qs({ ...filterParams, page: prevPage ?? 1, pageSize })}`}
              aria-disabled={!prevPage}
              className={
                "rounded-lg border px-3 py-2 text-sm font-semibold " +
                (prevPage
                  ? "border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                  : "border-gray-200 opacity-40 pointer-events-none dark:border-gray-800")
              }
            >
              Previous
            </Link>

            <Link
              href={`/admin/quotes${qs({ ...filterParams, page: nextPage ?? safePage, pageSize })}`}
              aria-disabled={!nextPage}
              className={
                "rounded-lg border px-3 py-2 text-sm font-semibold " +
                (nextPage
                  ? "border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                  : "border-gray-200 opacity-40 pointer-events-none dark:border-gray-800")
              }
            >
              Next
            </Link>
          </div>

          {/* page size selector (no JS) */}
          <form action="/admin/quotes" method="GET" className="flex items-center gap-2">
            {/* preserve canonical filters */}
            {filterParams.view ? <input type="hidden" name="view" value={String(filterParams.view)} /> : null}
            {filterParams.stage ? <input type="hidden" name="stage" value={String(filterParams.stage)} /> : null}

            <input type="hidden" name="page" value="1" />
            <label className="text-sm text-gray-600 dark:text-gray-300">Rows:</label>
            <select
              name="pageSize"
              defaultValue={String(pageSize)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
            >
              Apply
            </button>
          </form>
        </div>

        {/* List */}
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
          {rows.length === 0 ? (
            <div className="p-6 text-sm text-gray-700 dark:text-gray-300">No quotes match these filters.</div>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {rows.map((r) => {
                const lead = pickLead(r.input);
                const st = normalizeStage(r.stage);
                const unread = !r.isRead;

                const wantsConfirm = confirmDelete && deleteId && deleteId === r.id;
                const anchor = `q-${r.id}`;

                const confirmHref =
                  `/admin/quotes` +
                  qs({ ...filterParams, page: safePage, pageSize, deleteId: r.id, confirmDelete: 1 }) +
                  `#${anchor}`;

                const cancelHref =
                  `/admin/quotes` + qs({ ...filterParams, page: safePage, pageSize }) + `#${anchor}`;

                return (
                  <li
                    key={r.id}
                    id={anchor}
                    className={"p-5 scroll-mt-24 " + (unread ? "bg-yellow-50/60 dark:bg-yellow-950/10" : "")}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/admin/quotes/${r.id}`} className="text-base font-semibold hover:underline">
                            {lead.name}
                          </Link>

                          {unread ? (
                            <span className="rounded-full border border-yellow-200 bg-yellow-50 px-2.5 py-1 text-[11px] font-semibold text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
                              Unread
                            </span>
                          ) : (
                            <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-semibold text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
                              Read
                            </span>
                          )}

                          {stageChip(st)}
                          {renderChip(r.renderStatus)}
                        </div>

                        <div className="mt-1 flex flex-wrap gap-2 text-sm text-gray-600 dark:text-gray-300">
                          {lead.phone ? <span className="font-mono">{lead.phone}</span> : <span className="italic">No phone</span>}
                          {lead.email ? (
                            <>
                              <span>·</span>
                              <span className="font-mono">{lead.email}</span>
                            </>
                          ) : null}
                        </div>

                        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                          {r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/admin/quotes/${r.id}`}
                            className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                          >
                            Open
                          </Link>

                          {!wantsConfirm ? (
                            <Link
                              href={confirmHref}
                              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/60"
                            >
                              Delete
                            </Link>
                          ) : null}
                        </div>

                        {wantsConfirm ? (
                          <div className="mt-1 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                            <div className="font-semibold">Delete this lead?</div>
                            <div className="mt-1">This cannot be undone.</div>

                            <div className="mt-3 flex items-center justify-end gap-2">
                              <Link
                                href={cancelHref}
                                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:hover:bg-gray-900"
                              >
                                Cancel
                              </Link>

                              <form action={deleteLead}>
                                <input type="hidden" name="id" value={r.id} />
                                <button
                                  type="submit"
                                  className="rounded-md bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
                                >
                                  Yes, delete
                                </button>
                              </form>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-3 font-mono text-[10px] text-gray-400 dark:text-gray-600">{r.id}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}