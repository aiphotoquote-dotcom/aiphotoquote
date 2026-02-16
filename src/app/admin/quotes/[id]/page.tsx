// src/app/admin/quotes/[id]/page.tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { quoteLogs, tenants } from "@/lib/db/schema";
import QuotePhotoGallery, { type QuotePhoto } from "@/components/admin/QuotePhotoGallery";

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
    jar.get("activeTenantId")?.value,
    jar.get("active_tenant_id")?.value,
    jar.get("tenantId")?.value,
    jar.get("tenant_id")?.value,

    jar.get("apq_activeTenantId")?.value,
    jar.get("apq_active_tenant_id")?.value,

    jar.get("__Host-activeTenantId")?.value,
    jar.get("__Host-active_tenant_id")?.value,
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

function safeMoney(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return v;
}

function formatUSD(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function titleizeKey(k: string) {
  const s = safeTrim(k).replace(/_/g, " ");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

function fmtBool(v: any) {
  return v === true ? "true" : v === false ? "false" : "—";
}

function fmtNum(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return String(Math.round(n));
}

type PageProps = {
  params: Promise<{ id: string }> | { id: string };
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
};

export default async function QuoteReviewPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const p = await params;
  const id = String((p as any)?.id ?? "").trim();
  if (!id) redirect("/admin/quotes");

  const sp = searchParams ? await searchParams : {};
  const skipAutoRead =
    sp?.skipAutoRead === "1" || (Array.isArray(sp?.skipAutoRead) && sp.skipAutoRead.includes("1"));

  const jar = await cookies();
  let tenantIdMaybe = getCookieTenantId(jar);

  // If cookie tenant exists, validate membership
  if (tenantIdMaybe) {
    const membership = await db.execute(sql`
      select 1 as ok
      from tenant_members
      where tenant_id = ${tenantIdMaybe}::uuid
        and clerk_user_id = ${userId}
        and status = 'active'
      limit 1
    `);
    const mrow = firstRow(membership);
    if (!mrow?.ok) tenantIdMaybe = null;
  }

  // Fallback: first owned tenant (legacy)
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

  // 1) Try strict tenant-scoped lookup (correct behavior)
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

  // 2) If not found, auto-heal:
  // Find the quote's tenant, verify membership, activate tenant cookie, and retry.
  if (!row) {
    const q = await db
      .select({ tenantId: quoteLogs.tenantId })
      .from(quoteLogs)
      .where(eq(quoteLogs.id, id))
      .limit(1)
      .then((r) => r[0] ?? null);

    const quoteTenantId = q?.tenantId ? String(q.tenantId) : null;

    if (quoteTenantId) {
      const membership = await db.execute(sql`
        select 1 as ok
        from tenant_members
        where tenant_id = ${quoteTenantId}::uuid
          and clerk_user_id = ${userId}
          and status = 'active'
        limit 1
      `);

      const mrow = firstRow(membership);
      if (mrow?.ok) {
        const next = `/admin/quotes/${encodeURIComponent(id)}`;
        redirect(
          `/api/admin/tenant/activate?tenantId=${encodeURIComponent(quoteTenantId)}&next=${encodeURIComponent(next)}`
        );
      }
    }

    // If we got here, user either isn't a member or quote doesn't exist
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

  // ---- NEW: normalize AI output (supports old and new shapes) ----
  const outAny: any = row.output ?? null;

  // "aiAssessment" is the bucket we render from; with the deterministic engine we store fields at top level.
  const aiAssessment =
    outAny?.assessment ??
    outAny?.output?.assessment ??
    outAny?.output ??
    outAny ??
    null;

  // Prefer new deterministic fields first
  const estLow = safeMoney(aiAssessment?.estimate_low ?? aiAssessment?.estimateLow ?? aiAssessment?.estimate?.low ?? aiAssessment?.estimate?.estimate_low);
  const estHigh = safeMoney(aiAssessment?.estimate_high ?? aiAssessment?.estimateHigh ?? aiAssessment?.estimate?.high ?? aiAssessment?.estimate?.estimate_high);

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

  // Deterministic pricing basis (new)
  const pricingBasis: any =
    aiAssessment?.pricing_basis ??
    outAny?.pricing_basis ??
    outAny?.output?.pricing_basis ??
    null;

  // Frozen snapshots (new)
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
                {estLow != null && estHigh != null ? chip(`${formatUSD(estLow)} – ${formatUSD(estHigh)}`, "green") : null}
                {confidence ? chip(`Confidence: ${String(confidence)}`, "gray") : null}
                {inspectionRequired === true ? chip("Inspection required", "yellow") : null}
              </div>
            </div>

            {/* NEW: Deterministic pricing debug panel */}
            <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">Pricing engine</div>
                <div className="flex flex-wrap gap-2 items-center">
                  {pricingBasis?.method ? chip(`Method: ${String(pricingBasis.method)}`, "blue") : chip("Method: —", "gray")}
                  {pricingBasis?.model ? chip(`Model: ${String(pricingBasis.model)}`, "gray") : null}
                  {pricingPolicySnap?.ai_mode ? chip(`AI mode: ${String(pricingPolicySnap.ai_mode)}`, "gray") : null}
                  {typeof pricingPolicySnap?.pricing_enabled === "boolean"
                    ? chip(`Pricing enabled: ${pricingPolicySnap.pricing_enabled ? "true" : "false"}`, pricingPolicySnap.pricing_enabled ? "green" : "yellow")
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
                        <span className="font-semibold">hours:</span>{" "}
                        {fmtNum(pricingBasis.hours?.low)} – {fmtNum(pricingBasis.hours?.high)}
                      </div>
                    ) : null}
                    {pricingBasis?.units ? (
                      <div>
                        <span className="font-semibold">units:</span>{" "}
                        {fmtNum(pricingBasis.units?.low)} – {fmtNum(pricingBasis.units?.high)}
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
  2
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

          {/* Rendering */}
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-semibold">Rendering</div>
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
                  <div className="mt-2 text-xs font-semibold text-gray-600 dark:text-gray-300">Click to open original</div>
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