// src/app/admin/quotes/[id]/page.tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import QuoteNotesComposer from "@/components/admin/QuoteNotesComposer";
import QuotePhotoGallery, { type QuotePhoto } from "@/components/admin/QuotePhotoGallery";

import { db } from "@/lib/db/client";
import {
  quoteLogs,
  quoteNotes,
  quoteRenders,
  quoteVersions,
  tenantMembers,
  tenants,
} from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function isUuid(v: unknown) {
  const s = String(v ?? "").trim();
  // good-enough UUID v4-ish shape check (keeps DB from throwing on ::uuid casts)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function getCookieTenantId(jar: Awaited<ReturnType<typeof cookies>>) {
  const candidates = [
    jar.get("activeTenantId")?.value,
    jar.get("active_tenant_id")?.value,
    jar.get("tenantId")?.value,
    jar.get("tenant_id")?.value,
    jar.get("apq_activeTenantId")?.value,
    jar.get("apq_active_tenant_id")?.value,
    jar.get("__Host-activeTenantId")?.value,
    jar.get("__Host-active_tenant_id")?.value,
  ].filter(Boolean) as string[];

  const first = candidates[0] || null;
  return first && isUuid(first) ? first : null;
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

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function safeMoney(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return v;
}

function formatUSD(n: number) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function fmtNum(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return String(Math.round(n));
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

  const email = c?.email ?? input?.email ?? input?.customer_context?.email ?? null;

  const phoneDigits = phone ? digitsOnly(String(phone)) : "";

  return {
    name: String(name || "New customer"),
    phone: phoneDigits ? formatUSPhone(phoneDigits) : null,
    phoneDigits: phoneDigits || null,
    email: email ? String(email) : null,
  };
}

function pickCustomerNotes(input: any) {
  const notes =
    input?.customer_context?.notes ??
    input?.customer_context?.customer?.notes ??
    input?.notes ??
    input?.customerNotes ??
    input?.message ??
    null;

  const s = notes == null ? "" : String(notes).trim();
  return s || "";
}

function pickPhotos(input: any): QuotePhoto[] {
  const out: QuotePhoto[] = [];

  const images = Array.isArray(input?.images) ? input.images : null;
  if (images) {
    for (const it of images) {
      const url = it?.url ?? it?.src ?? it?.href;
      if (url) out.push({ url: String(url), label: it?.shotType ?? it?.label ?? null });
    }
  }

  const photos = Array.isArray(input?.photos) ? input.photos : null;
  if (photos) {
    for (const it of photos) {
      const url = it?.url ?? it?.src ?? it?.href;
      if (url) out.push({ url: String(url), label: it?.label ?? null });
    }
  }

  const imageUrls = Array.isArray(input?.imageUrls) ? input.imageUrls : null;
  if (imageUrls) {
    for (const url of imageUrls) if (url) out.push({ url: String(url) });
  }

  const ccImages = Array.isArray(input?.customer_context?.images) ? input.customer_context.images : null;
  if (ccImages) {
    for (const it of ccImages) {
      const url = it?.url ?? it?.src ?? it?.href;
      if (url) out.push({ url: String(url), label: it?.label ?? null });
    }
  }

  const seen = new Set<string>();
  return out.filter((p) => {
    if (!p.url) return false;
    if (seen.has(p.url)) return false;
    seen.add(p.url);
    return true;
  });
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

function normalizeStage(s: unknown): StageKey | "read" {
  const v = String(s ?? "").toLowerCase().trim();
  if (v === "read") return "read";
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
            : "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-200";
  return <span className={cn(base, cls)}>{label}</span>;
}

function renderChip(renderStatusRaw: unknown) {
  const s = String(renderStatusRaw ?? "").toLowerCase().trim();
  if (!s) return null;
  if (s === "rendered") return chip("Rendered", "green");
  if (s === "failed") return chip("Render failed", "red");
  if (s === "queued" || s === "running") return chip(s === "queued" ? "Queued" : "Rendering…", "blue");
  if (s === "not_requested") return chip("No render requested", "gray");
  return chip(s, "gray");
}

function tryJson(v: any): any {
  if (v == null) return null;
  if (typeof v === "object") return v;
  if (typeof v !== "string") return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function pickAiAssessmentFromAny(outAny: any) {
  const o = outAny ?? null;
  return o?.assessment ?? o?.output?.assessment ?? o?.output ?? o ?? null;
}

function extractEstimate(outAny: any): { low: number | null; high: number | null } {
  const a = pickAiAssessmentFromAny(outAny);
  const low = safeMoney(a?.estimate_low ?? a?.estimateLow ?? a?.estimate?.low ?? a?.estimate?.estimate_low);
  const high = safeMoney(a?.estimate_high ?? a?.estimateHigh ?? a?.estimate?.high ?? a?.estimate?.estimate_high);
  return { low, high };
}

function humanWhen(v: any) {
  try {
    if (!v) return "—";
    const d = v instanceof Date ? v : new Date(String(v));
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

/* -------------------- pricing policy helpers (admin view) -------------------- */
type AiMode = "assessment_only" | "range" | "fixed";
type PricingModel =
  | "flat_per_job"
  | "hourly_plus_materials"
  | "per_unit"
  | "packages"
  | "line_items"
  | "inspection_only"
  | "assessment_fee";

type PricingPolicySnapshot = {
  ai_mode: AiMode;
  pricing_enabled: boolean;
  pricing_model: PricingModel | null;
};

function normalizePricingPolicy(raw: any): PricingPolicySnapshot {
  const pricing_enabled = Boolean(raw?.pricing_enabled);

  const aiRaw = String(raw?.ai_mode ?? "").trim().toLowerCase();
  const ai_mode: AiMode =
    pricing_enabled && (aiRaw === "range" || aiRaw === "fixed" || aiRaw === "assessment_only")
      ? (aiRaw as AiMode)
      : pricing_enabled
        ? "range"
        : "assessment_only";

  const pmRaw = String(raw?.pricing_model ?? "").trim();
  const pricing_model: PricingModel | null =
    pricing_enabled &&
    (pmRaw === "flat_per_job" ||
      pmRaw === "hourly_plus_materials" ||
      pmRaw === "per_unit" ||
      pmRaw === "packages" ||
      pmRaw === "line_items" ||
      pmRaw === "inspection_only" ||
      pmRaw === "assessment_fee")
      ? (pmRaw as PricingModel)
      : null;

  if (!pricing_enabled) return { ai_mode: "assessment_only", pricing_enabled: false, pricing_model: null };
  return { ai_mode, pricing_enabled: true, pricing_model };
}

function coerceMode(policy: PricingPolicySnapshot): AiMode {
  if (!policy.pricing_enabled) return "assessment_only";
  if (policy.ai_mode === "fixed") return "fixed";
  if (policy.ai_mode === "range") return "range";
  return "assessment_only";
}

function formatEstimateForPolicy(args: {
  estLow: number | null;
  estHigh: number | null;
  policy: PricingPolicySnapshot;
}): { text: string | null; tone: "green" | "gray"; label: string } {
  const mode = coerceMode(args.policy);

  if (mode === "assessment_only") {
    return { text: null, tone: "gray", label: "Assessment only" };
  }

  const low = args.estLow;
  const high = args.estHigh;

  if (mode === "fixed") {
    const one = low != null ? low : high != null ? high : null;
    return { text: one != null ? formatUSD(one) : null, tone: "green", label: "Fixed estimate" };
  }

  // range
  if (low != null && high != null) {
    return { text: `${formatUSD(low)} – ${formatUSD(high)}`, tone: "green", label: "Range estimate" };
  }
  if (low != null) return { text: formatUSD(low), tone: "green", label: "Range estimate" };
  if (high != null) return { text: formatUSD(high), tone: "green", label: "Range estimate" };
  return { text: null, tone: "green", label: "Range estimate" };
}

type PageProps = {
  params: Promise<{ id: string }> | { id: string };
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

type EngineKey = "deterministic_pricing_only" | "full_ai_reassessment";

function normalizeEngine(v: any): EngineKey {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "full_ai_reassessment" || s === "full" || s === "ai") return "full_ai_reassessment";
  return "deterministic_pricing_only";
}

function normalizeAiMode(v: any): AiMode {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "fixed" || s === "range" || s === "assessment_only") return s as AiMode;
  return "assessment_only";
}

export default async function QuoteReviewPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const p = await params;
  const id = String((p as any)?.id ?? "").trim();
  if (!id) redirect("/admin/quotes");

  // Keep redirects safe: if someone hits /admin/quotes/foo, don't explode on UUID comparisons
  if (!isUuid(id)) redirect("/admin/quotes");

  const sp = searchParams ? await searchParams : {};
  const skipAutoRead =
    sp?.skipAutoRead === "1" || (Array.isArray(sp?.skipAutoRead) && sp.skipAutoRead.includes("1"));

  const jar = await cookies();
  let tenantIdMaybe = getCookieTenantId(jar);

  // If cookie tenant exists, validate membership
  if (tenantIdMaybe) {
    const membership = await db
      .select({ ok: sql<number>`1` })
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.tenantId, tenantIdMaybe),
          eq(tenantMembers.clerkUserId, userId),
          eq(tenantMembers.status, "active"),
        ),
      )
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!membership?.ok) tenantIdMaybe = null;
  }

  // Fallback: first owned tenant (legacy back-compat)
  if (!tenantIdMaybe) {
    const t = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.ownerClerkUserId, userId))
      .limit(1)
      .then((r) => r[0] ?? null);

    tenantIdMaybe = t?.id ?? null;
  }

  if (!tenantIdMaybe) redirect("/admin/quotes");
  const tenantId = tenantIdMaybe;

  // 1) Strict tenant-scoped lookup
  let row = await db
    .select({
      id: quoteLogs.id,
      tenantId: quoteLogs.tenantId,
      createdAt: quoteLogs.createdAt,
      input: quoteLogs.input,
      output: quoteLogs.output,
      stage: quoteLogs.stage,
      isRead: quoteLogs.isRead,
      renderOptIn: quoteLogs.renderOptIn,
      renderStatus: quoteLogs.renderStatus,
      renderImageUrl: quoteLogs.renderImageUrl,
      renderError: quoteLogs.renderError,
      renderPrompt: quoteLogs.renderPrompt,
      renderedAt: quoteLogs.renderedAt,
    })
    .from(quoteLogs)
    .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)))
    .limit(1)
    .then((r) => r[0] ?? null);

  // 2) Auto-heal if quote belongs to a different tenant the user is a member of
  if (!row) {
    const q = await db
      .select({ tenantId: quoteLogs.tenantId })
      .from(quoteLogs)
      .where(eq(quoteLogs.id, id))
      .limit(1)
      .then((r) => r[0] ?? null);

    const quoteTenantId = q?.tenantId ? String(q.tenantId) : null;

    if (quoteTenantId && isUuid(quoteTenantId)) {
      const membership = await db
        .select({ ok: sql<number>`1` })
        .from(tenantMembers)
        .where(
          and(
            eq(tenantMembers.tenantId, quoteTenantId),
            eq(tenantMembers.clerkUserId, userId),
            eq(tenantMembers.status, "active"),
          ),
        )
        .limit(1)
        .then((r) => r[0] ?? null);

      if (membership?.ok) {
        const next = `/admin/quotes/${encodeURIComponent(id)}`;
        redirect(
          `/api/admin/tenant/activate?tenantId=${encodeURIComponent(quoteTenantId)}&next=${encodeURIComponent(next)}`,
        );
      }
    }

    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/admin/quotes" className="text-sm font-semibold text-gray-600 hover:underline dark:text-gray-300">
          ← Back to quotes
        </Link>

        <div className="mt-6 rounded-2xl border border-yellow-200 bg-yellow-50 p-6 text-sm text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
          <div className="text-base font-semibold">Quote not found for the active tenant</div>
          <div className="mt-2">
            The quote either belongs to a different tenant (and you’re not a member), or it no longer exists.
          </div>
          <div className="mt-3 font-mono text-xs opacity-80">
            quoteId={id} · activeTenantId={tenantId}
          </div>
          <div className="mt-4">
            <Link
              href="/admin/quotes"
              className="inline-flex rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
            >
              Go back
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Track UI-state for read/unread (because we update DB after fetch)
  let isRead = Boolean(row.isRead);

  if (!skipAutoRead && !isRead) {
    await db
      .update(quoteLogs)
      .set({ isRead: true } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    isRead = true;
  }

  const lead = pickLead(row.input);
  const notes = pickCustomerNotes(row.input);
  const photos = pickPhotos(row.input);

  const stageNorm = normalizeStage(row.stage);
  const stageLabel =
    stageNorm === "read" ? "Read (legacy)" : STAGES.find((s) => s.key === stageNorm)?.label ?? "New";

  // ---- normalize AI output (supports old and new shapes) ----
  const outAny: any = row.output ?? null;
  const aiAssessment = pickAiAssessmentFromAny(outAny);

  const estLow = safeMoney(
    aiAssessment?.estimate_low ??
      aiAssessment?.estimateLow ??
      aiAssessment?.estimate?.low ??
      aiAssessment?.estimate?.estimate_low,
  );
  const estHigh = safeMoney(
    aiAssessment?.estimate_high ??
      aiAssessment?.estimateHigh ??
      aiAssessment?.estimate?.high ??
      aiAssessment?.estimate?.estimate_high,
  );

  const confidence = aiAssessment?.confidence ?? null;

  const inspectionRequired =
    typeof aiAssessment?.inspection_required === "boolean"
      ? aiAssessment.inspection_required
      : typeof aiAssessment?.inspectionRequired === "boolean"
        ? aiAssessment.inspectionRequired
        : null;

  const summary = String(aiAssessment?.summary ?? "").trim();

  const questions: string[] = Array.isArray(aiAssessment?.questions)
    ? aiAssessment.questions.map((x: any) => String(x))
    : [];
  const assumptions: string[] = Array.isArray(aiAssessment?.assumptions)
    ? aiAssessment.assumptions.map((x: any) => String(x))
    : [];
  const visibleScope: string[] = Array.isArray(aiAssessment?.visible_scope)
    ? aiAssessment.visible_scope.map((x: any) => String(x))
    : [];

  const pricingBasis: any =
    aiAssessment?.pricing_basis ?? outAny?.pricing_basis ?? outAny?.output?.pricing_basis ?? null;

  const inputAny: any = row.input ?? {};
  const pricingPolicySnap: any = inputAny?.pricing_policy_snapshot ?? null;
  const pricingConfigSnap: any = inputAny?.pricing_config_snapshot ?? null;
  const pricingRulesSnap: any = inputAny?.pricing_rules_snapshot ?? null;

  const industryKeySnap =
    safeTrim(inputAny?.industryKeySnapshot) ||
    safeTrim(inputAny?.industry_key_snapshot) ||
    safeTrim(inputAny?.customer_context?.category) ||
    null;

  const llmKeySource = safeTrim(inputAny?.llmKeySource) || null;

  const normalizedPolicy = normalizePricingPolicy(pricingPolicySnap ?? null);
  const estimateDisplay = formatEstimateForPolicy({ estLow, estHigh, policy: normalizedPolicy });

  // -------------------- lifecycle tables --------------------
  type QuoteVersionRow = {
    id: string;
    version: number;
    createdAt: any;
    createdBy: string | null;
    source: string | null;
    reason: string | null;
    aiMode: string | null;
    output: any;
    meta: any;
  };

  type QuoteNoteRow = {
    id: string;
    createdAt: any;
    actor: string | null;
    body: string;
    quoteVersionId: string | null;
  };

  type QuoteRenderRow = {
    id: string;
    attempt: number;
    status: string;
    createdAt: any;
    imageUrl: string | null;
    prompt: string | null;
    shopNotes: string | null;
    error: string | null;
    quoteVersionId: string;
  };

  let versionRows: QuoteVersionRow[] = [];
  let noteRows: QuoteNoteRow[] = [];
  let renderRows: QuoteRenderRow[] = [];
  let lifecycleReadError: string | null = null;

  try {
    versionRows = await db
      .select({
        id: quoteVersions.id,
        version: quoteVersions.version,
        createdAt: quoteVersions.createdAt,
        createdBy: quoteVersions.createdBy,
        source: quoteVersions.source,
        reason: quoteVersions.reason,
        aiMode: quoteVersions.aiMode,
        output: quoteVersions.output,
        meta: quoteVersions.meta,
      })
      .from(quoteVersions)
      .where(and(eq(quoteVersions.quoteLogId, id), eq(quoteVersions.tenantId, tenantId)))
      .orderBy(asc(quoteVersions.version), asc(quoteVersions.createdAt));
  } catch (e: any) {
    lifecycleReadError = safeTrim(e?.message) || "Failed to read quote_versions";
  }

  try {
    noteRows = await db
      .select({
        id: quoteNotes.id,
        createdAt: quoteNotes.createdAt,
        actor: quoteNotes.actor,
        body: quoteNotes.body,
        quoteVersionId: quoteNotes.quoteVersionId,
      })
      .from(quoteNotes)
      .where(and(eq(quoteNotes.quoteLogId, id), eq(quoteNotes.tenantId, tenantId)))
      .orderBy(desc(quoteNotes.createdAt))
      .limit(200);
  } catch (e: any) {
    lifecycleReadError = lifecycleReadError ?? (safeTrim(e?.message) || "Failed to read quote_notes");
  }

  try {
    renderRows = await db
      .select({
        id: quoteRenders.id,
        attempt: quoteRenders.attempt,
        status: quoteRenders.status,
        createdAt: quoteRenders.createdAt,
        imageUrl: quoteRenders.imageUrl,
        prompt: quoteRenders.prompt,
        shopNotes: quoteRenders.shopNotes,
        error: quoteRenders.error,
        quoteVersionId: quoteRenders.quoteVersionId,
      })
      .from(quoteRenders)
      .where(and(eq(quoteRenders.quoteLogId, id), eq(quoteRenders.tenantId, tenantId)))
      .orderBy(desc(quoteRenders.createdAt))
      .limit(200);
  } catch (e: any) {
    lifecycleReadError = lifecycleReadError ?? (safeTrim(e?.message) || "Failed to read quote_renders");
  }

  function renderStatusTone(s: string): "gray" | "blue" | "green" | "red" | "yellow" {
    const v = String(s ?? "").toLowerCase().trim();
    if (v === "rendered") return "green";
    if (v === "failed") return "red";
    if (v === "running" || v === "queued") return "blue";
    return "gray";
  }

  function versionChip(v: number) {
    return chip(`v${v}`, "blue");
  }

  function miniKeyValue(label: string, value: any) {
    return (
      <div className="text-xs text-gray-700 dark:text-gray-300">
        <span className="font-semibold text-gray-900 dark:text-gray-100">{label}:</span>{" "}
        <span className="font-mono">{safeTrim(value) || "—"}</span>
      </div>
    );
  }

  async function setStage(formData: FormData) {
    "use server";
    const next = String(formData.get("stage") ?? "").trim().toLowerCase();
    const allowed = new Set(STAGES.map((s) => s.key));
    if (!allowed.has(next as any)) redirect(`/admin/quotes/${encodeURIComponent(id)}`);

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
    redirect(`/admin/quotes/${encodeURIComponent(id)}?skipAutoRead=1`);
  }

  async function markRead() {
    "use server";
    await db
      .update(quoteLogs)
      .set({ isRead: true } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    redirect(`/admin/quotes/${encodeURIComponent(id)}`);
  }

  async function createNewVersion(formData: FormData) {
    "use server";

    const engine = normalizeEngine(formData.get("engine"));
    const aiMode = normalizeAiMode(formData.get("ai_mode"));
    const reason = safeTrim(formData.get("reason"));
    const noteBody = safeTrim(formData.get("note_body"));

    // next version number, scoped to (tenant_id, quote_log_id)
    const vmax = await db
      .select({
        v: sql<number>`coalesce(max(${quoteVersions.version}), 0)`,
      })
      .from(quoteVersions)
      .where(and(eq(quoteVersions.quoteLogId, id), eq(quoteVersions.tenantId, tenantId)))
      .then((r) => r[0]?.v ?? 0);

    const nextVersion = Number(vmax ?? 0) + 1;

    // freeze current output snapshot so UI shows something immediately
    const frozenOutput = (row?.output ?? {}) as any;

    const meta = {
      engine,
      created_from: "admin",
      created_from_version: versionRows.length
        ? Number(versionRows[versionRows.length - 1]?.version ?? 0)
        : null,
      notes_included: Boolean(noteBody),
      note_preview: noteBody ? noteBody.slice(0, 240) : null,
      needs_ai_reassessment: engine === "full_ai_reassessment",
      ts: new Date().toISOString(),
    };

    const inserted = await db
      .insert(quoteVersions)
      .values({
        tenantId,
        quoteLogId: id,
        version: nextVersion,
        aiMode,
        source: "tenant_edit",
        createdBy: userId, // clerk user id (portable enough for now)
        reason: reason || null,
        output: frozenOutput ?? {},
        meta: meta ?? {},
      })
      .returning({ id: quoteVersions.id })
      .then((r) => r[0] ?? null);

    const newVersionId = inserted?.id ? String(inserted.id) : null;

    if (noteBody) {
      await db.insert(quoteNotes).values({
        tenantId,
        quoteLogId: id,
        quoteVersionId: newVersionId,
        actor: userId,
        body: noteBody,
      });
    }

    // NOTE: The "right way" to run reassessment is to queue a job and have a worker
    // write updated output back into quote_versions.output (+ meta).
    // For now we only mark meta.needs_ai_reassessment=true and store notes.

    redirect(`/admin/quotes/${encodeURIComponent(id)}`);
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/admin/quotes" className="text-sm font-semibold text-gray-600 hover:underline dark:text-gray-300">
            ← Back to quotes
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Quote review</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Submitted {row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}
          </p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-950">
          <div className="flex flex-wrap items-center gap-2">
            {isRead ? chip("Read", "gray") : chip("Unread", "yellow")}
            {chip(`Stage: ${stageLabel}`, stageNorm === "new" ? "blue" : "gray")}
            {renderChip(row.renderStatus)}
            {confidence ? chip(`Confidence: ${String(confidence)}`, "gray") : null}
            {inspectionRequired === true ? chip("Inspection required", "yellow") : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {isRead ? (
              <form action={markUnread}>
                <button
                  type="submit"
                  className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                >
                  Mark unread
                </button>
              </form>
            ) : (
              <form action={markRead}>
                <button
                  type="submit"
                  className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                >
                  Mark read
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Lead / Contact card */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{lead.name}</h2>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-700 dark:text-gray-200">
              {lead.phone ? (
                <a
                  href={`tel:${lead.phoneDigits ?? digitsOnly(lead.phone)}`}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm hover:bg-white dark:border-gray-800 dark:bg-black dark:hover:bg-gray-900"
                >
                  {lead.phone}
                </a>
              ) : (
                <span className="italic text-gray-500">No phone</span>
              )}

              {lead.email ? (
                <a
                  href={`mailto:${lead.email}`}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm hover:bg-white dark:border-gray-800 dark:bg-black dark:hover:bg-gray-900"
                >
                  {lead.email}
                </a>
              ) : null}
            </div>
          </div>

          <div className="w-full lg:w-[340px]">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black">
              <div className="text-sm font-semibold">Stage</div>
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">Stage is separate from read/unread.</p>

              <form action={setStage} className="mt-4 flex items-center gap-2">
                <select
                  name="stage"
                  defaultValue={stageNorm === "read" ? "new" : (stageNorm as any)}
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

              {stageNorm === "read" ? (
                <div className="mt-3 text-xs text-yellow-900 dark:text-yellow-200">
                  Note: legacy stage value <span className="font-mono">read</span>. Saving will normalize it.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* Customer notes */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div>
          <h3 className="text-lg font-semibold">Customer notes</h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">What the customer told you when submitting.</p>
        </div>

        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-200">
          {notes ? (
            <div className="whitespace-pre-wrap leading-relaxed">{notes}</div>
          ) : (
            <div className="italic text-gray-500">No notes provided.</div>
          )}
        </div>
      </section>

      <QuotePhotoGallery photos={photos} />

      {/* Quote lifecycle */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Quote lifecycle</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Versions, internal notes, and render attempts.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {versionRows.length
              ? chip(`${versionRows.length} version${versionRows.length === 1 ? "" : "s"}`, "blue")
              : chip("No versions yet", "gray")}
            {noteRows.length ? chip(`${noteRows.length} note${noteRows.length === 1 ? "" : "s"}`, "gray") : null}
            {renderRows.length
              ? chip(`${renderRows.length} render${renderRows.length === 1 ? "" : "s"}`, "gray")
              : null}
          </div>
        </div>

        {/* Create version */}
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-gray-800 dark:text-gray-200">
              Create new version
            </summary>

            <div className="mt-3 text-xs text-gray-600 dark:text-gray-300">
              Choose engine + mode. Optional notes are stored in quote_notes and linked to the new version.
            </div>

            <form action={createNewVersion} className="mt-4 grid gap-3">
              <div className="grid gap-2 lg:grid-cols-2">
                <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Engine</div>
                  <div className="mt-2 space-y-2 text-sm">
                    <label className="flex items-start gap-2">
                      <input
                        type="radio"
                        name="engine"
                        value="deterministic_pricing_only"
                        defaultChecked
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-semibold">Deterministic pricing only</span>
                        <span className="block text-xs text-gray-600 dark:text-gray-400">
                          Freeze current output; pricing path can be wired next.
                        </span>
                      </span>
                    </label>

                    <label className="flex items-start gap-2">
                      <input type="radio" name="engine" value="full_ai_reassessment" className="mt-0.5" />
                      <span>
                        <span className="font-semibold">Full AI reassessment</span>
                        <span className="block text-xs text-gray-600 dark:text-gray-400">
                          Marks meta.needs_ai_reassessment=true; wiring the reassessment job is the next step.
                        </span>
                      </span>
                    </label>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">AI mode</div>
                  <select
                    name="ai_mode"
                    defaultValue="assessment_only"
                    className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
                  >
                    <option value="assessment_only">assessment_only</option>
                    <option value="range">range</option>
                    <option value="fixed">fixed</option>
                  </select>

                  <div className="mt-3 text-xs font-semibold text-gray-700 dark:text-gray-300">Reason (optional)</div>
                  <input
                    name="reason"
                    placeholder="e.g. customer clarified scope, new photos, reprice..."
                    className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  New notes for this version (optional)
                </div>
                <textarea
                  name="note_body"
                  rows={4}
                  placeholder="Add anything the shop learned. This will be saved to quote_notes linked to the new version."
                  className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                >
                  Create version
                </button>
                <span className="text-xs text-gray-600 dark:text-gray-300">
                  Creates quote_versions row (+ quote_notes if provided).
                </span>
              </div>
            </form>
          </details>
        </div>

        {lifecycleReadError ? (
          <div className="mt-4 rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
            <div className="font-semibold">Lifecycle tables not available yet</div>
            <div className="mt-1 font-mono text-xs break-words">{lifecycleReadError}</div>
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {/* Versions */}
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">Versions</div>
              {versionRows.length ? chip("History", "blue") : chip("Empty", "gray")}
            </div>

            <div className="mt-3 space-y-3">
              {versionRows.length ? (
                versionRows.slice(0, 30).map((v) => {
                  const out = tryJson(v.output) ?? v.output;
                  const est = extractEstimate(out);
                  const conf = safeTrim(pickAiAssessmentFromAny(out)?.confidence ?? "");
                  const summ = safeTrim(pickAiAssessmentFromAny(out)?.summary ?? "");
                  const policyMode = safeTrim(v.aiMode) || null;

                  const estText =
                    est.low != null && est.high != null
                      ? `${formatUSD(est.low)} – ${formatUSD(est.high)}`
                      : est.low != null
                        ? formatUSD(est.low)
                        : est.high != null
                          ? formatUSD(est.high)
                          : null;

                  return (
                    <div
                      key={v.id}
                      className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {versionChip(Number(v.version ?? 0))}
                          {policyMode ? chip(`mode: ${policyMode}`, "gray") : null}
                          {safeTrim(v.source) ? chip(String(v.source), "gray") : null}
                          {safeTrim(v.createdBy) ? chip(String(v.createdBy), "gray") : null}
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-300">{humanWhen(v.createdAt)}</div>
                      </div>

                      {v.reason ? (
                        <div className="mt-2 text-xs text-gray-700 dark:text-gray-200">
                          <span className="font-semibold">Reason:</span> {String(v.reason)}
                        </div>
                      ) : null}

                      <div className="mt-2 space-y-1">
                        {estText ? miniKeyValue("Estimate", estText) : miniKeyValue("Estimate", "—")}
                        {conf ? miniKeyValue("Confidence", conf) : null}
                      </div>

                      {summ ? (
                        <div className="mt-2 text-xs text-gray-700 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
                          {summ}
                        </div>
                      ) : null}

                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs font-semibold text-gray-700 dark:text-gray-300">
                          Raw version output (debug)
                        </summary>
                        <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-black p-3 text-[11px] text-white dark:border-gray-800">
{JSON.stringify(out ?? {}, null, 2)}
                        </pre>
                      </details>
                    </div>
                  );
                })
              ) : (
                <div className="text-sm text-gray-600 dark:text-gray-300 italic">No versions yet.</div>
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">Internal notes</div>
              {noteRows.length ? chip("Log", "gray") : chip("Empty", "gray")}
            </div>

            <div className="mt-3">
              <QuoteNotesComposer quoteLogId={id} />
            </div>

            <div className="mt-3 space-y-3">
              {noteRows.length ? (
                noteRows.slice(0, 100).map((n) => (
                  <div
                    key={n.id}
                    className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {safeTrim(n.actor) ? chip(String(n.actor), "gray") : chip("tenant", "gray")}
                        {n.quoteVersionId ? chip("linked to version", "blue") : chip("general", "gray")}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-300">{humanWhen(n.createdAt)}</div>
                    </div>
                    <div className="mt-2 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
                      {safeTrim(n.body) || <span className="italic text-gray-500">Empty note.</span>}
                    </div>
                    {n.quoteVersionId ? (
                      <div className="mt-2 text-[11px] text-gray-600 dark:text-gray-300 font-mono break-all">
                        versionId: {n.quoteVersionId}
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="text-sm text-gray-600 dark:text-gray-300 italic">No notes yet.</div>
              )}
            </div>
          </div>

          {/* Renders */}
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">Render attempts</div>
              {renderRows.length ? chip("History", "gray") : chip("Empty", "gray")}
            </div>

            <div className="mt-3 space-y-3">
              {renderRows.length ? (
                renderRows.slice(0, 60).map((r) => (
                  <div
                    key={r.id}
                    className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {chip(`Attempt ${Number(r.attempt ?? 1)}`, "gray")}
                        {chip(String(r.status ?? "unknown"), renderStatusTone(String(r.status ?? "")))}
                        {r.quoteVersionId ? chip("from version", "blue") : null}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-300">{humanWhen(r.createdAt)}</div>
                    </div>

                    {r.imageUrl ? (
                      <a href={r.imageUrl} target="_blank" rel="noreferrer" className="mt-3 block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={r.imageUrl}
                          alt="Render attempt"
                          className="w-full rounded-xl border border-gray-200 bg-white object-contain dark:border-gray-800"
                        />
                        <div className="mt-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
                          Click to open original
                        </div>
                      </a>
                    ) : (
                      <div className="mt-3 text-sm text-gray-600 dark:text-gray-300 italic">
                        No image_url for this attempt.
                      </div>
                    )}

                    {r.error ? (
                      <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 whitespace-pre-wrap dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
                        {r.error}
                      </div>
                    ) : null}

                    {r.shopNotes ? (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs font-semibold text-gray-700 dark:text-gray-300">
                          Shop notes
                        </summary>
                        <div className="mt-2 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
                          {String(r.shopNotes)}
                        </div>
                      </details>
                    ) : null}

                    {r.prompt ? (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs font-semibold text-gray-700 dark:text-gray-300">
                          Render prompt (debug)
                        </summary>
                        <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-black p-3 text-[11px] text-white dark:border-gray-800">
{String(r.prompt)}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="text-sm text-gray-600 dark:text-gray-300 italic">No render attempts yet.</div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Details */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Details</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              AI describes scope. Server computes dollars (deterministic).
            </p>
          </div>
          {row.renderOptIn ? chip("Customer opted into render", "blue") : chip("No render opt-in", "gray")}
        </div>

        <div className="mt-5 grid gap-4">
          {/* AI Assessment + Pricing */}
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-semibold">AI assessment</div>
              <div className="flex flex-wrap items-center gap-2">
                {estimateDisplay.text ? chip(estimateDisplay.text, estimateDisplay.tone) : null}
                {chip(estimateDisplay.label, estimateDisplay.label === "Assessment only" ? "gray" : "blue")}
                {confidence ? chip(`Confidence: ${String(confidence)}`, "gray") : null}
                {inspectionRequired === true ? chip("Inspection required", "yellow") : null}
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">Pricing engine</div>
                <div className="flex flex-wrap gap-2 items-center">
                  {pricingBasis?.method ? chip(`Method: ${String(pricingBasis.method)}`, "blue") : chip("Method: —", "gray")}
                  {pricingBasis?.model ? chip(`Model: ${String(pricingBasis.model)}`, "gray") : null}
                  {pricingPolicySnap?.ai_mode ? chip(`AI mode: ${String(pricingPolicySnap.ai_mode)}`, "gray") : null}
                  {typeof pricingPolicySnap?.pricing_enabled === "boolean"
                    ? chip(
                        `Pricing enabled: ${pricingPolicySnap.pricing_enabled ? "true" : "false"}`,
                        pricingPolicySnap.pricing_enabled ? "green" : "yellow",
                      )
                    : null}
                </div>
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-3">
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-800 dark:bg-black">
                  <div className="font-semibold text-gray-700 dark:text-gray-200">Frozen context</div>
                  <div className="mt-2 space-y-1 text-gray-700 dark:text-gray-300">
                    <div>
                      <span className="font-semibold">industryKey:</span> {industryKeySnap ?? "—"}
                    </div>
                    <div>
                      <span className="font-semibold">llmKeySource:</span> {llmKeySource ?? "—"}
                    </div>
                    <div>
                      <span className="font-semibold">pricing_model (policy):</span>{" "}
                      {pricingPolicySnap?.pricing_model ?? "—"}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-800 dark:bg-black">
                  <div className="font-semibold text-gray-700 dark:text-gray-200">Computed basis</div>
                  <div className="mt-2 space-y-1 text-gray-700 dark:text-gray-300">
                    <div>
                      <span className="font-semibold">confW:</span> {pricingBasis?.confW ?? "—"}
                    </div>
                    <div>
                      <span className="font-semibold">complexity:</span> {pricingBasis?.complexity ?? "—"}
                    </div>
                    <div>
                      <span className="font-semibold">minJobApplied:</span> {pricingBasis?.minJobApplied ?? "—"}
                    </div>
                    <div>
                      <span className="font-semibold">maxWithoutInspectionApplied:</span>{" "}
                      {pricingBasis?.maxWithoutInspectionApplied ?? "—"}
                    </div>
                    <div>
                      <span className="font-semibold">forcedInspection:</span>{" "}
                      {pricingBasis?.forcedInspection ? "true" : "false"}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-800 dark:bg-black">
                  <div className="font-semibold text-gray-700 dark:text-gray-200">Model math</div>
                  <div className="mt-2 space-y-1 text-gray-700 dark:text-gray-300">
                    {pricingBasis?.hours ? (
                      <div>
                        <span className="font-semibold">hours:</span> {fmtNum(pricingBasis.hours?.low)} –{" "}
                        {fmtNum(pricingBasis.hours?.high)}
                      </div>
                    ) : null}
                    {pricingBasis?.units ? (
                      <div>
                        <span className="font-semibold">units:</span> {fmtNum(pricingBasis.units?.low)} –{" "}
                        {fmtNum(pricingBasis.units?.high)}
                      </div>
                    ) : null}
                    {pricingBasis?.hourly ? (
                      <div>
                        <span className="font-semibold">hourly:</span> {fmtNum(pricingBasis.hourly)}
                      </div>
                    ) : null}
                    {pricingBasis?.perUnitRate ? (
                      <div>
                        <span className="font-semibold">perUnitRate:</span> {fmtNum(pricingBasis.perUnitRate)}{" "}
                        {pricingBasis?.perUnitLabel ? `/${String(pricingBasis.perUnitLabel)}` : ""}
                      </div>
                    ) : null}
                    {pricingBasis?.base != null ? (
                      <div>
                        <span className="font-semibold">base:</span> {fmtNum(pricingBasis.base)}
                      </div>
                    ) : null}
                    {pricingBasis?.spread != null ? (
                      <div>
                        <span className="font-semibold">spread:</span> {fmtNum(pricingBasis.spread)}
                      </div>
                    ) : null}
                    {pricingBasis?.fee != null ? (
                      <div>
                        <span className="font-semibold">fee:</span> {fmtNum(pricingBasis.fee)}
                      </div>
                    ) : null}
                    {!pricingBasis ? <div className="italic text-gray-500">No pricing_basis found (older quote).</div> : null}
                  </div>
                </div>
              </div>

              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Frozen pricing snapshots (policy / config / rules)
                </summary>
                <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-black p-4 text-xs text-white dark:border-gray-800">
{JSON.stringify(
  {
    pricing_policy_snapshot: pricingPolicySnap ?? null,
    pricing_config_snapshot: pricingConfigSnap ?? null,
    pricing_rules_snapshot: pricingRulesSnap ?? null,
  },
  null,
  2,
)}
                </pre>
              </details>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <div className="text-xs font-semibold tracking-wide text-gray-500 dark:text-gray-400">SUMMARY</div>
                <div className="mt-2 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
                  {summary ? summary : <span className="italic text-gray-500">No summary found.</span>}
                </div>
              </div>

              <div className="grid gap-3">
                {questions.length ? (
                  <div>
                    <div className="text-xs font-semibold tracking-wide text-gray-500 dark:text-gray-400">QUESTIONS</div>
                    <ul className="mt-2 list-disc pl-5 text-sm text-gray-800 dark:text-gray-200 space-y-1">
                      {questions.slice(0, 8).map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {visibleScope.length ? (
                  <div>
                    <div className="text-xs font-semibold tracking-wide text-gray-500 dark:text-gray-400">VISIBLE SCOPE</div>
                    <ul className="mt-2 list-disc pl-5 text-sm text-gray-800 dark:text-gray-200 space-y-1">
                      {visibleScope.slice(0, 8).map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {assumptions.length ? (
                  <div>
                    <div className="text-xs font-semibold tracking-wide text-gray-500 dark:text-gray-400">ASSUMPTIONS</div>
                    <ul className="mt-2 list-disc pl-5 text-sm text-gray-800 dark:text-gray-200 space-y-1">
                      {assumptions.slice(0, 8).map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {!aiAssessment ? (
                  <div className="text-sm text-gray-600 dark:text-gray-300 italic">
                    No AI output found yet (quoteLogs.output is empty).
                  </div>
                ) : null}
              </div>
            </div>

            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-semibold text-gray-700 dark:text-gray-300">
                Raw AI JSON (debug)
              </summary>
              <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-black p-4 text-xs text-white dark:border-gray-800">
{JSON.stringify(row.output ?? {}, null, 2)}
              </pre>
            </details>
          </div>

          {/* Rendering (legacy) */}
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-semibold">Rendering (legacy)</div>
              <div className="flex flex-wrap items-center gap-2">
                {renderChip(row.renderStatus)}
                {row.renderedAt ? chip(new Date(row.renderedAt).toLocaleString(), "gray") : null}
              </div>
            </div>

            <div className="mt-4">
              {row.renderImageUrl ? (
                <a href={row.renderImageUrl} target="_blank" rel="noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={row.renderImageUrl}
                    alt="AI render"
                    className="w-full rounded-2xl border border-gray-200 bg-white object-contain dark:border-gray-800"
                  />
                  <div className="mt-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
                    Click to open original
                  </div>
                </a>
              ) : (
                <div className="text-sm text-gray-600 dark:text-gray-300 italic">No render available for this quote.</div>
              )}

              {row.renderError ? (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 whitespace-pre-wrap dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
                  {row.renderError}
                </div>
              ) : null}

              {row.renderPrompt ? (
                <details className="mt-4">
                  <summary className="cursor-pointer text-xs font-semibold text-gray-700 dark:text-gray-300">
                    Render prompt (debug)
                  </summary>
                  <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-black p-4 text-xs text-white dark:border-gray-800">
{String(row.renderPrompt)}
                  </pre>
                </details>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <details className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <summary className="cursor-pointer text-sm font-semibold">Raw submission payload</summary>
        <pre className="mt-4 overflow-auto rounded-xl border border-gray-200 bg-black p-4 text-xs text-white dark:border-gray-800">
{JSON.stringify(row.input ?? {}, null, 2)}
        </pre>
      </details>
    </div>
  );
}