// src/app/admin/quotes/[id]/page.tsx
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import QuotePhotoGallery from "@/components/admin/QuotePhotoGallery";

import QuoteHeader from "@/components/admin/quote/QuoteHeader";
import LeadCard from "@/components/admin/quote/LeadCard";
import CustomerNotesCard from "@/components/admin/quote/CustomerNotesCard";
import LifecyclePanel from "@/components/admin/quote/LifecyclePanel";
import DetailsPanel from "@/components/admin/quote/DetailsPanel";
import LegacyRenderPanel from "@/components/admin/quote/LegacyRenderPanel";
import RawPayloadPanel from "@/components/admin/quote/RawPayloadPanel";

import { db } from "@/lib/db/client";
import { quoteLogs, quoteNotes, tenantMembers } from "@/lib/db/schema";

import { resolveActiveTenantId } from "@/lib/admin/quotes/getActiveTenant";
import { findRedirectTenantForQuote, getAdminQuoteRow } from "@/lib/admin/quotes/getQuote";
import { getQuoteLifecycle } from "@/lib/admin/quotes/getLifecycle";

import {
  formatEstimateForPolicy,
  normalizeAiMode,
  normalizeEngine,
  normalizePricingPolicy,
  normalizeStage,
  pickAiAssessmentFromAny,
  pickCustomerNotes,
  pickIndustryKeySnapshot,
  pickLead,
  pickLlmKeySource,
  pickPhotos,
  type AdminReassessEngine,
  type QuoteLogRow,
} from "@/lib/admin/quotes/pageCompat";

import { adminReassessQuote } from "@/lib/quotes/adminReassess";
import { safeMoney, safeTrim } from "@/lib/admin/quotes/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }> | { id: string };
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

function spGet(sp: any, key: string): string {
  const v = sp?.[key];
  if (Array.isArray(v)) return String(v[0] ?? "");
  return v == null ? "" : String(v);
}

function bannerTone(kind: "error" | "info") {
  return kind === "error"
    ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200"
    : "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/40 dark:text-blue-200";
}

export default async function QuoteReviewPage({ params, searchParams }: PageProps) {
  const session = await auth();
  const userId = session.userId;
  if (!userId) redirect("/sign-in");

  const p = await params;
  const id = String((p as any)?.id ?? "").trim();
  if (!id) redirect("/admin/quotes");

  const sp = searchParams ? await searchParams : {};
  const skipAutoRead =
    spGet(sp, "skipAutoRead") === "1" || (Array.isArray((sp as any)?.skipAutoRead) && (sp as any).skipAutoRead.includes("1"));

  const jar = await cookies();

  // IMPORTANT: keep tenantId strictly typed as string for server-action closures
  const tenantIdMaybe = await resolveActiveTenantId({ jar, userId });
  if (!tenantIdMaybe) redirect("/admin/quotes");
  const tenantId: string = tenantIdMaybe;

  // 1) Strict tenant-scoped lookup
  let row = await getAdminQuoteRow({ id, tenantId });

  // 2) Auto-heal if quote belongs to a different tenant the user is a member of
  if (!row) {
    const redirectTenantId = await findRedirectTenantForQuote({ id, userId });
    if (redirectTenantId) {
      const next = `/admin/quotes/${encodeURIComponent(id)}`;
      redirect(
        `/api/admin/tenant/activate?tenantId=${encodeURIComponent(redirectTenantId)}&next=${encodeURIComponent(next)}`
      );
    }

    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <a href="/admin/quotes" className="text-sm font-semibold text-gray-600 hover:underline dark:text-gray-300">
          ← Back to quotes
        </a>

        <div className="mt-6 rounded-2xl border border-yellow-200 bg-yellow-50 p-6 text-sm text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
          <div className="text-base font-semibold">Quote not found for the active tenant</div>
          <div className="mt-2">
            The quote either belongs to a different tenant (and you’re not a member), or it no longer exists.
          </div>
          <div className="mt-3 font-mono text-xs opacity-80">quoteId={id} · activeTenantId={tenantId}</div>
          <div className="mt-4">
            <a
              href="/admin/quotes"
              className="inline-flex rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
            >
              Go back
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ✅ Snapshot non-null row for server-action closures
  const rowSnap = row;

  // Track UI-state for read/unread (because we update DB after fetch)
  let isRead = Boolean(rowSnap.isRead);

  if (!skipAutoRead && !isRead) {
    await db
      .update(quoteLogs)
      .set({ isRead: true } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    isRead = true;
  }

  const lead = pickLead(rowSnap.input);
  const notes = pickCustomerNotes(rowSnap.input);
  const photos = pickPhotos(rowSnap.input);

  const stageNorm = normalizeStage(rowSnap.stage);
  const stageLabel =
    stageNorm === "read"
      ? "Read (legacy)"
      : (await import("@/lib/admin/quotes/normalize")).STAGES.find((s) => s.key === stageNorm)?.label ?? "New";

  // ---- normalize AI output (supports old and new shapes) ----
  const outAny: any = rowSnap.output ?? null;
  const aiAssessment = pickAiAssessmentFromAny(outAny);

  const estLow = safeMoney(
    aiAssessment?.estimate_low ??
      aiAssessment?.estimateLow ??
      aiAssessment?.estimate?.low ??
      aiAssessment?.estimate?.estimate_low
  );
  const estHigh = safeMoney(
    aiAssessment?.estimate_high ??
      aiAssessment?.estimateHigh ??
      aiAssessment?.estimate?.high ??
      aiAssessment?.estimate?.estimate_high
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

  const pricingBasis: any = aiAssessment?.pricing_basis ?? outAny?.pricing_basis ?? outAny?.output?.pricing_basis ?? null;

  const inputAny: any = rowSnap.input ?? {};
  const pricingPolicySnap: any = inputAny?.pricing_policy_snapshot ?? null;
  const pricingConfigSnap: any = inputAny?.pricing_config_snapshot ?? null;
  const pricingRulesSnap: any = inputAny?.pricing_rules_snapshot ?? null;

  const industryKeySnap = pickIndustryKeySnapshot(inputAny);
  const llmKeySource = pickLlmKeySource(inputAny);

  const normalizedPolicy = normalizePricingPolicy(pricingPolicySnap ?? null);
  const estimateDisplay = formatEstimateForPolicy({ estLow, estHigh, policy: normalizedPolicy });

  // lifecycle
  const { versionRows, noteRows, renderRows, lifecycleReadError } = await getQuoteLifecycle({ id, tenantId });

  // ✅ active pointer for Versions UI
  const activeVersion = typeof (rowSnap as any).currentVersion === "number" ? Number((rowSnap as any).currentVersion) : null;

  // banners from querystring
  const renderError = safeTrim(spGet(sp, "renderError"));
  const renderVersionId = safeTrim(spGet(sp, "versionId"));
  const renderExpectedQuote = safeTrim(spGet(sp, "expectedQuote"));
  const renderExpectedTenant = safeTrim(spGet(sp, "expectedTenant"));
  const renderFoundQuote = safeTrim(spGet(sp, "foundQuote"));
  const renderFoundTenant = safeTrim(spGet(sp, "foundTenant"));

  /* -------------------- server actions -------------------- */
  async function setStage(formData: FormData) {
    "use server";

    const session = await auth();
    if (!session.userId) redirect("/sign-in");

    const next = String(formData.get("stage") ?? "").trim().toLowerCase();
    const allowed = new Set((await import("@/lib/admin/quotes/normalize")).STAGES.map((s) => s.key));
    if (!allowed.has(next as any)) redirect(`/admin/quotes/${encodeURIComponent(id)}`);

    await db
      .update(quoteLogs)
      .set({ stage: next } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));

    redirect(`/admin/quotes/${encodeURIComponent(id)}`);
  }

  async function markUnread() {
    "use server";

    const session = await auth();
    if (!session.userId) redirect("/sign-in");

    await db
      .update(quoteLogs)
      .set({ isRead: false } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    redirect(`/admin/quotes/${encodeURIComponent(id)}?skipAutoRead=1`);
  }

  async function markRead() {
    "use server";

    const session = await auth();
    if (!session.userId) redirect("/sign-in");

    await db
      .update(quoteLogs)
      .set({ isRead: true } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    redirect(`/admin/quotes/${encodeURIComponent(id)}`);
  }

  async function createNewVersion(formData: FormData) {
    "use server";

    const session = await auth();
    const actorUserId = session.userId;
    if (!actorUserId) redirect("/sign-in");

    const engineUi = normalizeEngine(formData.get("engine"));
    const aiMode = normalizeAiMode(formData.get("ai_mode"));
    const reason = safeTrim(formData.get("reason"));
    const noteBody = safeTrim(formData.get("note_body"));

    // Optional note first (unlinked for now)
    let createdNoteId: string | null = null;
    if (noteBody) {
      const inserted = await db
        .insert(quoteNotes)
        .values({
          tenantId,
          quoteLogId: id,
          quoteVersionId: null,
          createdBy: actorUserId,
          body: noteBody,
        } as any)
        .returning({ id: quoteNotes.id })
        .then((r) => r[0] ?? null);

      createdNoteId = inserted?.id ? String(inserted.id) : null;
    }

    const engine: AdminReassessEngine = engineUi === "full_ai_reassessment" ? "openai_assessment" : "deterministic_only";

    const quoteLog: QuoteLogRow = {
      id,
      tenant_id: tenantId,
      input: rowSnap.input ?? {},
      qa: (rowSnap as any).qa ?? {},
      output: rowSnap.output ?? {},
    };

    const result = await adminReassessQuote({
      quoteLog,
      createdBy: actorUserId,
      engine,
      contextNotesLimit: 50,
      source: "admin.page",
      reason: reason || undefined,
    });

    if (createdNoteId) {
      await db
        .update(quoteNotes)
        .set({ quoteVersionId: result.versionId } as any)
        .where(and(eq(quoteNotes.id, createdNoteId), eq(quoteNotes.tenantId, tenantId)));
    }

    // UI-only selection (not persisted here)
    void aiMode;

    redirect(`/admin/quotes/${encodeURIComponent(id)}`);
  }

  async function restoreVersion(formData: FormData) {
    "use server";

    const session = await auth();
    const actorUserId = session.userId;
    if (!actorUserId) redirect("/sign-in");

    const versionId = safeTrim(formData.get("version_id"));
    if (!versionId) redirect(`/admin/quotes/${encodeURIComponent(id)}`);

    const membership = await db
      .select({ ok: sql<number>`1` })
      .from(tenantMembers)
      .where(
        and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.clerkUserId, actorUserId), eq(tenantMembers.status, "active"))
      )
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!membership?.ok) redirect(`/admin/quotes/${encodeURIComponent(id)}`);

    const updated = await db.execute(sql`
      with picked as (
        select
          v.output as output,
          v.version as version
        from quote_versions v
        where v.id = ${versionId}::uuid
          and v.tenant_id = ${tenantId}::uuid
          and v.quote_log_id = ${id}::uuid
        limit 1
      )
      update quote_logs q
      set
        output = picked.output,
        current_version = picked.version
      from picked
      where q.id = ${id}::uuid
        and q.tenant_id = ${tenantId}::uuid
      returning q.id::text as "id"
    `);

    const ok = Boolean((updated as any)?.rows?.[0]?.id);
    if (!ok) redirect(`/admin/quotes/${encodeURIComponent(id)}?restoreError=1`);

    redirect(`/admin/quotes/${encodeURIComponent(id)}`);
  }

  async function requestRender(formData: FormData) {
    "use server";

    const session = await auth();
    const actorUserId = session.userId;
    if (!actorUserId) redirect("/sign-in");

    const versionId = safeTrim(formData.get("version_id"));
    const shopNotes = safeTrim(formData.get("shop_notes"));

    if (!versionId) {
      redirect(`/admin/quotes/${encodeURIComponent(id)}?renderError=missing_version`);
    }

    const membership = await db
      .select({ ok: sql<number>`1` })
      .from(tenantMembers)
      .where(
        and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.clerkUserId, actorUserId), eq(tenantMembers.status, "active"))
      )
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!membership?.ok) redirect(`/admin/quotes/${encodeURIComponent(id)}?renderError=forbidden`);

    // ✅ Diagnostics: does this version exist at all? and what does it belong to?
    const vmeta = await db.execute(sql`
      select
        v.id::text as id,
        v.tenant_id::text as tenant_id,
        v.quote_log_id::text as quote_log_id
      from quote_versions v
      where v.id = ${versionId}::uuid
      limit 1
    `);

    const vm: any = (vmeta as any)?.rows?.[0] ?? null;

    if (!vm?.id) {
      redirect(
        `/admin/quotes/${encodeURIComponent(id)}?renderError=version_not_found&versionId=${encodeURIComponent(
          versionId
        )}&expectedQuote=${encodeURIComponent(id)}&expectedTenant=${encodeURIComponent(tenantId)}`
      );
    }

    const foundTenant = String(vm.tenant_id ?? "");
    const foundQuote = String(vm.quote_log_id ?? "");

    if (foundTenant !== tenantId) {
      redirect(
        `/admin/quotes/${encodeURIComponent(id)}?renderError=version_tenant_mismatch&versionId=${encodeURIComponent(
          versionId
        )}&expectedTenant=${encodeURIComponent(tenantId)}&foundTenant=${encodeURIComponent(foundTenant)}`
      );
    }

    if (foundQuote !== id) {
      redirect(
        `/admin/quotes/${encodeURIComponent(id)}?renderError=version_quote_mismatch&versionId=${encodeURIComponent(
          versionId
        )}&expectedQuote=${encodeURIComponent(id)}&foundQuote=${encodeURIComponent(foundQuote)}`
      );
    }

    // Next attempt per version
    const ar = await db.execute(sql`
      select coalesce(max(r.attempt), 0) as "max_attempt"
      from quote_renders r
      where r.tenant_id = ${tenantId}::uuid
        and r.quote_version_id = ${versionId}::uuid
    `);

    const maxAttemptRaw = (ar as any)?.rows?.[0]?.max_attempt ?? 0;
    const nextAttempt = Number(maxAttemptRaw ?? 0) + 1;

    const ins = await db.execute(sql`
      insert into quote_renders (
        tenant_id,
        quote_log_id,
        quote_version_id,
        attempt,
        status,
        shop_notes,
        created_at
      )
      values (
        ${tenantId}::uuid,
        ${id}::uuid,
        ${versionId}::uuid,
        ${nextAttempt},
        'queued',
        ${shopNotes || null},
        now()
      )
      returning id::text as "id"
    `);

    const ok = Boolean((ins as any)?.rows?.[0]?.id);
    if (!ok) redirect(`/admin/quotes/${encodeURIComponent(id)}?renderError=insert_failed&versionId=${encodeURIComponent(versionId)}`);

    redirect(`/admin/quotes/${encodeURIComponent(id)}#renders`);
  }

  /* -------------------- render -------------------- */
  const submittedAtLabel = rowSnap.createdAt ? new Date(rowSnap.createdAt).toLocaleString() : "—";

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
      {renderError ? (
        <div className={"rounded-2xl border p-4 text-sm " + bannerTone("error")}>
          <div className="font-semibold">Render request failed: {renderError}</div>
          <div className="mt-2 text-xs font-mono break-all opacity-90">
            quoteId={id} · tenantId={tenantId}
            {renderVersionId ? ` · versionId=${renderVersionId}` : ""}
            {renderExpectedQuote ? ` · expectedQuote=${renderExpectedQuote}` : ""}
            {renderFoundQuote ? ` · foundQuote=${renderFoundQuote}` : ""}
            {renderExpectedTenant ? ` · expectedTenant=${renderExpectedTenant}` : ""}
            {renderFoundTenant ? ` · foundTenant=${renderFoundTenant}` : ""}
          </div>
          <div className="mt-2 text-xs opacity-90">
            This usually means the Versions list is not properly scoped to this quote+tenant. Next step: fix <span className="font-mono">getQuoteLifecycle</span>.
          </div>
        </div>
      ) : null}

      <QuoteHeader
        quoteId={id}
        submittedAtLabel={submittedAtLabel}
        isRead={isRead}
        stageLabel={stageLabel}
        stageNorm={String(stageNorm)}
        renderStatus={rowSnap.renderStatus}
        confidence={confidence}
        inspectionRequired={inspectionRequired}
        activeVersion={activeVersion}
        markUnreadAction={markUnread}
        markReadAction={markRead}
      />

      <LeadCard lead={lead} stageNorm={String(stageNorm)} setStageAction={setStage} />

      <CustomerNotesCard notes={notes} />

      <QuotePhotoGallery photos={photos} />

      <LifecyclePanel
        quoteId={id}
        versionRows={versionRows}
        noteRows={noteRows}
        renderRows={renderRows}
        lifecycleReadError={lifecycleReadError}
        activeVersion={activeVersion}
        createNewVersionAction={createNewVersion}
        restoreVersionAction={restoreVersion}
        requestRenderAction={requestRender}
      />

      <DetailsPanel
        renderOptIn={Boolean(rowSnap.renderOptIn)}
        estimateDisplay={estimateDisplay}
        confidence={confidence}
        inspectionRequired={inspectionRequired}
        summary={summary}
        questions={questions}
        assumptions={assumptions}
        visibleScope={visibleScope}
        pricingBasis={pricingBasis}
        pricingPolicySnap={pricingPolicySnap}
        pricingConfigSnap={pricingConfigSnap}
        pricingRulesSnap={pricingRulesSnap}
        industryKeySnap={industryKeySnap}
        llmKeySource={llmKeySource}
        rawOutput={rowSnap.output ?? null}
      />

      <LegacyRenderPanel
        renderStatus={rowSnap.renderStatus}
        renderedAt={rowSnap.renderedAt}
        renderImageUrl={rowSnap.renderImageUrl ? String(rowSnap.renderImageUrl) : null}
        renderError={rowSnap.renderError ? String(rowSnap.renderError) : null}
        renderPrompt={rowSnap.renderPrompt ? String(rowSnap.renderPrompt) : null}
      />

      <RawPayloadPanel input={rowSnap.input ?? {}} />
    </div>
  );
}