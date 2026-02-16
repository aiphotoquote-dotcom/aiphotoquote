// src/app/admin/quotes/page.tsx

import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { quoteLogs, tenants } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

// Drizzle RowList can be array-like; avoid `.rows`
function firstRow(r: any): any | null {
  try {
    if (!r) return null;
    if (Array.isArray(r)) return r[0] ?? null;
    if (typeof r === "object" && r !== null && 0 in r) return (r as any)[0] ?? null;
    return null;
  } catch {
    return null;
  }
}

function getCookieTenantId(jar: Awaited<ReturnType<typeof cookies>>) {
  const candidates = [
    // common variants
    jar.get("activeTenantId")?.value,
    jar.get("active_tenant_id")?.value,
    jar.get("tenantId")?.value,
    jar.get("tenant_id")?.value,

    // “namespaced” variants (often used by custom switchers)
    jar.get("apq_activeTenantId")?.value,
    jar.get("apq_active_tenant_id")?.value,
    jar.get("apqTenantId")?.value,
    jar.get("apq_tenant_id")?.value,

    // __Host- prefix variants (stricter cookie rules)
    jar.get("__Host-activeTenantId")?.value,
    jar.get("__Host-active_tenant_id")?.value,
    jar.get("__Host-tenantId")?.value,
    jar.get("__Host-tenant_id")?.value,
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
  const c = input?.customer ?? input?.contact ?? input?.customer_context?.customer ?? input?.lead ?? input?.contact ?? {};

  const name =
    c?.name ?? c?.fullName ?? c?.customerName ?? input?.name ?? input?.customer_context?.name ?? "New customer";

  const phone = c?.phone ?? c?.phoneNumber ?? input?.phone ?? input?.customer_context?.phone ?? null;

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

function chip(label: string, tone: "gray" | "blue" | "yellow" | "green" | "red" = "gray") {
  const base = "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold";
  const cls =
    tone === "green"
      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
      : tone === "yellow"
        ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200"
        : tone === "red"
          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          : tone === "blue"
            ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
            : "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200";

  return <span className={cn(base, cls)}>{label}</span>;
}

function safeParseMaybeJson(v: any) {
  if (v == null) return null;
  if (typeof v === "object") return v;
  if (typeof v !== "string") return { value: v };

  const s = v.trim();
  if (!s) return null;

  if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
    try {
      return JSON.parse(s);
    } catch {
      return { raw: v };
    }
  }
  return { raw: v };
}

function normalizeAiOutput(outputRaw: any) {
  const root = safeParseMaybeJson(outputRaw) ?? null;
  const assessment = root?.assessment && typeof root.assessment === "object" ? root.assessment : null;
  const out = root?.output && typeof root.output === "object" ? root.output : null;

  const merged = {
    ...(typeof root === "object" ? root : {}),
    ...(out ?? {}),
    ...(assessment ?? {}),
  };

  const est = merged?.estimate && typeof merged.estimate === "object" ? merged.estimate : null;

  const estimateLow = est?.low ?? merged?.estimateLow ?? merged?.estimate_low ?? root?.estimate?.low ?? null;
  const estimateHigh = est?.high ?? merged?.estimateHigh ?? merged?.estimate_high ?? root?.estimate?.high ?? null;

  return {
    summary: merged?.summary ?? null,
    confidence: merged?.confidence ?? null,
    inspectionRequired:
      typeof merged?.inspection_required === "boolean"
        ? merged.inspection_required
        : typeof merged?.inspectionRequired === "boolean"
          ? merged.inspectionRequired
          : null,
    estimateLow,
    estimateHigh,
  };
}

function asNumber(x: any): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string") {
    const n = Number(x.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function money(n: number | null): string {
  if (n == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `$${Math.round(n).toString()}`;
  }
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

function filterPill(opts: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={opts.href}
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold transition",
        opts.active
          ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
          : "border-gray-200 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-200 dark:hover:bg-gray-900"
      )}
    >
      {opts.label}
    </Link>
  );
}

/* ------------------------- pricing display helpers ------------------------- */
type PricingPolicyLite = {
  pricing_enabled: boolean;
  ai_mode: "assessment_only" | "range" | "fixed";
  pricing_model: string | null;
};

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function normalizePricingPolicyLite(v: any): PricingPolicyLite | null {
  if (!v || typeof v !== "object") return null;

  const pricing_enabled = Boolean((v as any).pricing_enabled);
  const ai_mode_raw = safeTrim((v as any).ai_mode) || "assessment_only";
  const ai_mode =
    ai_mode_raw === "assessment_only" || ai_mode_raw === "range" || ai_mode_raw === "fixed"
      ? (ai_mode_raw as PricingPolicyLite["ai_mode"])
      : "assessment_only";

  const pricing_model = safeTrim((v as any).pricing_model) || null;

  // enforce your rule locally too: disabled => assessment_only + null model
  if (!pricing_enabled) return { pricing_enabled: false, ai_mode: "assessment_only", pricing_model: null };

  return { pricing_enabled: true, ai_mode, pricing_model };
}

function humanizePricingModel(m: string | null) {
  const s = safeTrim(m);
  if (!s) return null;

  // keep it “engineer readable” but not ugly
  const map: Record<string, string> = {
    flat_per_job: "Flat",
    hourly_plus_materials: "Hourly + Materials",
    per_unit: "Per-unit",
    packages: "Packages",
    line_items: "Line items",
    inspection_only: "Inspection only",
    assessment_fee: "Assessment fee",
  };

  return map[s] ?? s.replace(/_/g, " ");
}

function humanizeAiMode(mode: PricingPolicyLite["ai_mode"]) {
  if (mode === "assessment_only") return "Assessment";
  if (mode === "fixed") return "Fixed";
  return "Range";
}

function extractPricingPolicyFromRow(args: { input: any; output: any }): PricingPolicyLite | null {
  const { input, output } = args;

  // 0) deterministic basis if you add it later
  const basis = output?.pricing_basis && typeof output.pricing_basis === "object" ? output.pricing_basis : null;
  const basisNorm = normalizePricingPolicyLite(basis);
  if (basisNorm) return basisNorm;

  // 1) snapshot in quote log input (phase1 freeze)
  const snap = input?.pricing_policy_snapshot && typeof input.pricing_policy_snapshot === "object" ? input.pricing_policy_snapshot : null;
  const snapNorm = normalizePricingPolicyLite(snap);
  if (snapNorm) return snapNorm;

  // 2) legacy separate fields (still in input)
  const legacy = {
    pricing_enabled: input?.pricing_enabled_snapshot,
    ai_mode: input?.ai_mode_snapshot,
    pricing_model: input?.pricing_model_snapshot,
  };
  const legacyNorm = normalizePricingPolicyLite(legacy);
  if (legacyNorm) return legacyNorm;

  // 3) ai_snapshot in output (newer path)
  const policy = output?.ai_snapshot?.pricing?.policy ?? null;
  const policyNorm = normalizePricingPolicyLite(policy);
  if (policyNorm) return policyNorm;

  return null;
}

function estimateDisplay(args: {
  policy: PricingPolicyLite | null;
  estLow: number | null;
  estHigh: number | null;
}) {
  const { policy, estLow, estHigh } = args;

  // No policy? fall back to showing whatever we have.
  if (!policy) {
    if (estLow == null && estHigh == null) return { kind: "none" as const, text: "No estimate yet" };
    return { kind: "money" as const, text: `${money(estLow)} – ${money(estHigh)}` };
  }

  if (!policy.pricing_enabled || policy.ai_mode === "assessment_only") {
    return { kind: "policy" as const, text: "Assessment only" };
  }

  if (policy.ai_mode === "fixed") {
    // if we have a clean single number, show it as a single value
    if (estLow != null && estHigh != null) {
      const a = Math.round(estLow);
      const b = Math.round(estHigh);
      if (Number.isFinite(a) && Number.isFinite(b) && a === b) return { kind: "money" as const, text: `${money(a)}` };
    }
    // otherwise show range fallback
    if (estLow == null && estHigh == null) return { kind: "none" as const, text: "Estimate pending" };
    return { kind: "money" as const, text: `${money(estLow)} – ${money(estHigh)}` };
  }

  // range mode
  if (estLow == null && estHigh == null) return { kind: "none" as const, text: "Estimate pending" };
  return { kind: "money" as const, text: `${money(estLow)} – ${money(estHigh)}` };
}

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
};

type ViewMode = "all" | "unread" | "new" | "in_progress" | "custom";

export default async function AdminQuotesPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const sp = searchParams ? await searchParams : {};

  // -------------------------
  // view= (canonical) + legacy filters
  // -------------------------
  const viewRaw = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  const viewNorm = String(viewRaw ?? "").toLowerCase().trim();

  const legacyUnread = sp.unread === "1" || (Array.isArray(sp.unread) && sp.unread.includes("1"));
  const legacyInProgress = sp.in_progress === "1" || (Array.isArray(sp.in_progress) && sp.in_progress.includes("1"));

  const stageParamRaw = Array.isArray(sp.stage) ? sp.stage[0] : sp.stage;
  const legacyStage = stageParamRaw ? normalizeStage(stageParamRaw) : null;

  let viewMode: ViewMode = "all";
  let unreadOnly = false;
  let inProgressOnly = false;
  let stageParam: StageKey | null = null;

  if (viewNorm) {
    if (viewNorm === "unread") {
      viewMode = "unread";
      unreadOnly = true;
    } else if (viewNorm === "new") {
      viewMode = "new";
      stageParam = "new";
    } else if (viewNorm === "in_progress" || viewNorm === "inprogress" || viewNorm === "pipeline") {
      viewMode = "in_progress";
      inProgressOnly = true;
    } else {
      viewMode = "custom";
    }
  } else {
    unreadOnly = legacyUnread;
    inProgressOnly = legacyInProgress;
    stageParam = legacyStage;
    viewMode = unreadOnly || inProgressOnly || stageParam ? "custom" : "all";
  }

  // pagination
  const page = clampInt(sp.page, 1, 1, 10_000);
  const pageSize = clampInt(sp.pageSize, 25, 5, 200);
  const offset = (page - 1) * pageSize;

  // delete confirm UI
  const deleteIdRaw = sp?.deleteId;
  const confirmDeleteRaw = sp?.confirmDelete;
  const deleteId = Array.isArray(deleteIdRaw) ? String(deleteIdRaw[0] ?? "") : String(deleteIdRaw ?? "");
  const confirmDelete = confirmDeleteRaw === "1" || (Array.isArray(confirmDeleteRaw) && confirmDeleteRaw.includes("1"));

  // -------------------------
  // tenant selection (cookie -> validated membership -> recent membership -> owned fallback)
  // -------------------------
  const jar = await cookies();
  let tenantIdMaybe = getCookieTenantId(jar);

  // validate cookie tenant membership (prevents stale/wrong tenant cookie)
  if (tenantIdMaybe) {
    const ok = await db.execute(sql`
      select 1 as ok
      from tenant_members
      where tenant_id = ${tenantIdMaybe}::uuid
        and clerk_user_id = ${userId}
        and status = 'active'
      limit 1
    `);
    if (!firstRow(ok)?.ok) tenantIdMaybe = null;
  }

  // fall back to most recently updated active membership
  if (!tenantIdMaybe) {
    const r = await db.execute(sql`
      select tenant_id
      from tenant_members
      where clerk_user_id = ${userId}
        and status = 'active'
      order by updated_at desc nulls last, created_at desc
      limit 1
    `);
    const row = firstRow(r);
    tenantIdMaybe = row?.tenant_id ? String(row.tenant_id) : null;
  }

  // last resort: first owned tenant
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
        <h1 className="text-2xl font-semibold">Quotes</h1>
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

  // -------------------------
  // WHERE filters
  // -------------------------
  const whereParts: any[] = [eq(quoteLogs.tenantId, tenantId)];

  if (unreadOnly) whereParts.push(eq(quoteLogs.isRead, false));

  if (inProgressOnly) {
    // rule: ONLY read / estimate / quoted
    whereParts.push(inArray(quoteLogs.stage, ["read", "estimate", "quoted"]));
  }

  if (stageParam) whereParts.push(eq(quoteLogs.stage, stageParam));

  const whereAll = and(...whereParts);
  const hasFilters = unreadOnly || inProgressOnly || Boolean(stageParam) || viewMode !== "all";

  // -------------------------
  // Preserve filter params in paging/delete links
  // Use view= if present/known; otherwise use legacy
  // -------------------------
  const useView = viewMode === "unread" || viewMode === "new" || viewMode === "in_progress";

  const filterParams: Record<string, string | number | null> = useView
    ? {
        view:
          viewMode === "unread"
            ? "unread"
            : viewMode === "new"
              ? "new"
              : viewMode === "in_progress"
                ? "in_progress"
                : null,
        unread: null,
        in_progress: null,
        stage: null,
      }
    : {
        view: null,
        unread: unreadOnly ? 1 : null,
        in_progress: inProgressOnly ? 1 : null,
        stage: stageParam ? stageParam : null,
      };

  async function deleteLead(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "").trim();
    if (!id) return;

    await db.delete(quoteLogs).where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));

    redirect(`/admin/quotes${qs({ ...filterParams, page, pageSize })}`);
  }

  // counts + rows
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
      output: (quoteLogs as any).output, // ✅ pull AI results
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

  // -------------------------
  // Pills (canonical view= links)
  // -------------------------
  const pillBase = { page: 1, pageSize };
  const hrefAll = `/admin/quotes${qs({ ...pillBase })}`;
  const hrefUnread = `/admin/quotes${qs({ ...pillBase, view: "unread" })}`;
  const hrefNew = `/admin/quotes${qs({ ...pillBase, view: "new" })}`;
  const hrefInProgress = `/admin/quotes${qs({ ...pillBase, view: "in_progress" })}`;

  const activeAll = viewMode === "all" && !useView && !unreadOnly && !inProgressOnly && !stageParam;
  const activeUnread = viewMode === "unread" || (!useView && unreadOnly);
  const activeNew = viewMode === "new" || (!useView && stageParam === "new");
  const activeInProgress = viewMode === "in_progress" || (!useView && inProgressOnly);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Quotes</h1>

          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            {totalCount} total{hasFilters ? " (filtered)" : ""} · {unreadCountOnPage} unread on this page · Page {safePage}{" "}
            / {totalPages}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {filterPill({ href: hrefAll, label: "All", active: activeAll })}
            {filterPill({ href: hrefUnread, label: "Unread", active: activeUnread })}
            {filterPill({ href: hrefNew, label: "New", active: activeNew })}
            {filterPill({ href: hrefInProgress, label: "In progress", active: activeInProgress })}

            {hasFilters ? (
              <Link href="/admin/quotes" className="ml-2 text-xs font-semibold underline text-gray-600 dark:text-gray-300">
                Clear
              </Link>
            ) : null}
          </div>
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
          {filterParams.view ? <input type="hidden" name="view" value={String(filterParams.view)} /> : null}
          {!filterParams.view && unreadOnly ? <input type="hidden" name="unread" value="1" /> : null}
          {!filterParams.view && inProgressOnly ? <input type="hidden" name="in_progress" value="1" /> : null}
          {!filterParams.view && stageParam ? <input type="hidden" name="stage" value={stageParam} /> : null}

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

              const outputObj = safeParseMaybeJson((r as any).output);
              const ai = normalizeAiOutput(outputObj);
              const policy = extractPricingPolicyFromRow({ input: r.input, output: outputObj });

              const estLow = asNumber(ai.estimateLow);
              const estHigh = asNumber(ai.estimateHigh);

              const conf = String(ai.confidence ?? "").toLowerCase().trim();
              const confTone = conf === "high" ? "green" : conf === "medium" ? "yellow" : conf === "low" ? "red" : "gray";

              const inspTone = ai.inspectionRequired === true ? "yellow" : ai.inspectionRequired === false ? "green" : "gray";

              const quoteId = String((r as any)?.id ?? "");
              const quoteHref = quoteId ? `/admin/quotes/${encodeURIComponent(quoteId)}` : "/admin/quotes";

              const wantsConfirm = confirmDelete && deleteId && deleteId === r.id;
              const anchor = `q-${r.id}`;

              const confirmHref =
                `/admin/quotes` + qs({ ...filterParams, page: safePage, pageSize, deleteId: r.id, confirmDelete: 1 }) + `#${anchor}`;

              const cancelHref = `/admin/quotes` + qs({ ...filterParams, page: safePage, pageSize }) + `#${anchor}`;

              const estDisp = estimateDisplay({ policy, estLow, estHigh });

              const pricingBadge = (() => {
                if (!policy) return null;

                if (!policy.pricing_enabled) return chip("Pricing: Off", "gray");

                const modeLabel = humanizeAiMode(policy.ai_mode);
                const modelLabel = humanizePricingModel(policy.pricing_model);

                // subtle but informative
                const label = modelLabel ? `Pricing: ${modeLabel} · ${modelLabel}` : `Pricing: ${modeLabel}`;
                const tone = policy.ai_mode === "assessment_only" ? "gray" : "blue";
                return chip(label, tone as any);
              })();

              return (
                <li key={r.id} id={anchor} className={cn("p-5 scroll-mt-24", unread ? "bg-yellow-50/60 dark:bg-yellow-950/10" : "")}>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={quoteHref} className="text-base font-semibold hover:underline">
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
                        {renderChip((r as any).renderStatus)}

                        {/* AI badges */}
                        {ai.confidence ? chip(`Confidence: ${String(ai.confidence)}`, confTone as any) : null}
                        {ai.inspectionRequired != null ? chip(ai.inspectionRequired ? "Inspection" : "No inspection", inspTone as any) : null}
                        {pricingBadge}
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

                      {/* Presentable AI preview */}
                      <div className="mt-3 grid gap-2">
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {estDisp.kind === "none" ? (
                            <span className="text-gray-500 dark:text-gray-400">{estDisp.text}</span>
                          ) : estDisp.kind === "policy" ? (
                            <span className="text-gray-700 dark:text-gray-200">{estDisp.text}</span>
                          ) : (
                            <>{estDisp.text}</>
                          )}
                        </div>

                        {ai.summary ? (
                          <div className="text-sm text-gray-700 dark:text-gray-200 line-clamp-2">{String(ai.summary)}</div>
                        ) : (
                          <div className="text-sm text-gray-500 dark:text-gray-400 italic">No AI summary yet.</div>
                        )}
                      </div>

                      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        {r.createdAt ? new Date(r.createdAt as any).toLocaleString() : "—"}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <div className="flex items-center gap-2">
                        <Link
                          href={quoteHref}
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
                              <button type="submit" className="rounded-md bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:opacity-90">
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
  );
}