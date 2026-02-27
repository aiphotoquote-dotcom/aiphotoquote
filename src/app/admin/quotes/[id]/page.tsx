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

/**
 * NOTE:
 * - Server actions stay in this page to avoid Next action scoping pitfalls.
 * - UI + data loading + parsing is modularized.
 */

type PageProps = {
  params: Promise<{ id: string }> | { id: string };
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

export default async function QuoteReviewPage({ params, searchParams }: PageProps) {
  const session = await auth();
  const userId = session.userId;
  if (!userId) redirect("/sign-in");

  const p = await params;
  const id = String((p as any)?.id ?? "").trim();
  if (!id) redirect("/admin/quotes");

  const sp = searchParams ? await searchParams : {};
  const skipAutoRead =
    sp?.skipAutoRead === "1" || (Array.isArray(sp?.skipAutoRead) && sp.skipAutoRead.includes("1"));

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
    stageNorm === "read"
      ? "Read (legacy)"
      : (await import("@/lib/admin/quotes/normalize")).STAGES.find((s) => s.key === stageNorm)?.label ?? "New";

  // ---- normalize AI output (supports old and new shapes) ----
  const outAny: any = row.output ?? null;
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

  const pricingBasis: any =
    aiAssessment?.pricing_basis ?? outAny?.pricing_basis ?? outAny?.output?.pricing_basis ?? null;

  const inputAny: any = row.input ?? {};
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
  const activeVersion =
    typeof (row as any).currentVersion === "number" ? Number((row as any).currentVersion) : null;

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
          actor: actorUserId,
          body: noteBody,
        })
        .returning({ id: quoteNotes.id })
        .then((r) => r[0] ?? null);

      createdNoteId = inserted?.id ? String(inserted.id) : null;
    }

    // Run real reassessment engine + pricing (creates version + updates quote_logs.output)
    const engine: AdminReassessEngine =
      engineUi === "full_ai_reassessment" ? "openai_assessment" : "deterministic_only";

    const quoteLog: QuoteLogRow = {
      id,
      tenant_id: tenantId,
      input: row.input ?? {},
      qa: (row as any).qa ?? {},
      output: row.output ?? {},
    };

    const result = await adminReassessQuote({
      quoteLog,
      createdBy: actorUserId,
      engine,
      contextNotesLimit: 50,
      source: "admin.page",
      reason: reason || undefined,
    });

    // If note was created, link it to the new version
    if (createdNoteId) {
      await db
        .update(quoteNotes)
        .set({ quoteVersionId: result.versionId } as any)
        .where(and(eq(quoteNotes.id, createdNoteId), eq(quoteNotes.tenantId, tenantId)));
    }

    // UI-only selection (not persisted here; authoritative is frozen snapshot)
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

    // membership check
    const membership = await db
      .select({ ok: sql<number>`1` })
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.tenantId, tenantId),
          eq(tenantMembers.clerkUserId, actorUserId),
          eq(tenantMembers.status, "active")
        )
      )
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!membership?.ok) redirect(`/admin/quotes/${encodeURIComponent(id)}`);

    // atomic restore: copy output + version pointer from quote_versions
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

  /* -------------------- render -------------------- */
  const submittedAtLabel = row.createdAt ? new Date(row.createdAt).toLocaleString() : "—";

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
      <QuoteHeader
        quoteId={id}
        submittedAtLabel={submittedAtLabel}
        isRead={isRead}
        stageLabel={stageLabel}
        stageNorm={String(stageNorm)}
        renderStatus={row.renderStatus}
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
      />

      <DetailsPanel
        renderOptIn={Boolean(row.renderOptIn)}
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
        rawOutput={row.output ?? null}
      />

      <LegacyRenderPanel
        renderStatus={row.renderStatus}
        renderedAt={row.renderedAt}
        renderImageUrl={row.renderImageUrl ? String(row.renderImageUrl) : null}
        renderError={row.renderError ? String(row.renderError) : null}
        renderPrompt={row.renderPrompt ? String(row.renderPrompt) : null}
      />

      <RawPayloadPanel input={row.input ?? {}} />
    </div>
  );
}