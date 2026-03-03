// src/app/admin/quotes/[id]/page.tsx
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import QuotePhotoGallery from "@/components/admin/QuotePhotoGallery";

import QuoteHeader from "@/components/admin/quote/QuoteHeader";
import LeadCard from "@/components/admin/quote/LeadCard";
import CustomerNotesCard from "@/components/admin/quote/CustomerNotesCard";
import DetailsPanel from "@/components/admin/quote/DetailsPanel";
import LegacyRenderPanel from "@/components/admin/quote/LegacyRenderPanel";
import RawPayloadPanel from "@/components/admin/quote/RawPayloadPanel";
import EmailBuilderPanel from "@/components/admin/quote/EmailBuilderPanel";
import LifecyclePanelServer from "@/components/admin/quote/LifecyclePanelServer";
import SentEmailsCard from "@/components/admin/quote/SentEmailsCard";

import { db } from "@/lib/db/client";
import { quoteLogs } from "@/lib/db/schema";

import { resolveActiveTenantId } from "@/lib/admin/quotes/getActiveTenant";
import { findRedirectTenantForQuote, getAdminQuoteRow } from "@/lib/admin/quotes/getQuote";
import { getQuoteLifecycle } from "@/lib/admin/quotes/getLifecycle";

import {
  formatEstimateForPolicy,
  normalizePricingPolicy,
  normalizeStage,
  pickAiAssessmentFromAny,
  pickCustomerNotes,
  pickIndustryKeySnapshot,
  pickLead,
  pickLlmKeySource,
  pickPhotos,
} from "@/lib/admin/quotes/pageCompat";

import { safeMoney } from "@/lib/admin/quotes/utils";

// ✅ IMPORT EXPORTED SERVER ACTIONS (module exports only; never page closures)
import { markReadAction, markUnreadAction, setStageAction } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    sp?.skipAutoRead === "1" || (Array.isArray(sp?.skipAutoRead) && (sp as any).skipAutoRead.includes("1"));

  const jar = await cookies();

  const tenantIdMaybe = await resolveActiveTenantId({ jar, userId });
  if (!tenantIdMaybe) redirect("/admin/quotes");
  const tenantId: string = String(tenantIdMaybe);

  const row = await getAdminQuoteRow({ id, tenantId });

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

  const rowSnap = row;

  let isRead = Boolean(rowSnap.isRead);

  // Keep your auto-mark-read behavior server-side
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

  const normalizeMod = await import("@/lib/admin/quotes/normalize");
  const STAGES = normalizeMod.STAGES;

  const stageMeta = STAGES.find((s) => s.key === stageNorm) ?? null;
  const stageLabel = stageNorm === "read" ? "Read (legacy)" : stageMeta?.label ?? "New";

  // ✅ Restore progress computation
  const stageIndex = Math.max(0, STAGES.findIndex((s) => s.key === stageNorm));
  const stagePct = STAGES.length > 1 ? Math.round((stageIndex / (STAGES.length - 1)) * 100) : 0;

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

  const questions: string[] = Array.isArray(aiAssessment?.questions) ? aiAssessment.questions.map((x: any) => String(x)) : [];
  const assumptions: string[] = Array.isArray(aiAssessment?.assumptions) ? aiAssessment.assumptions.map((x: any) => String(x)) : [];
  const visibleScope: string[] = Array.isArray(aiAssessment?.visible_scope) ? aiAssessment.visible_scope.map((x: any) => String(x)) : [];

  const pricingBasis: any = aiAssessment?.pricing_basis ?? outAny?.pricing_basis ?? outAny?.output?.pricing_basis ?? null;

  const inputAny: any = rowSnap.input ?? {};
  const pricingPolicySnap: any = inputAny?.pricing_policy_snapshot ?? null;
  const pricingConfigSnap: any = inputAny?.pricing_config_snapshot ?? null;
  const pricingRulesSnap: any = inputAny?.pricing_rules_snapshot ?? null;

  const industryKeySnap = pickIndustryKeySnapshot(inputAny);
  const llmKeySource = pickLlmKeySource(inputAny);

  const normalizedPolicy = normalizePricingPolicy(pricingPolicySnap ?? null);
  const estimateDisplay = formatEstimateForPolicy({ estLow, estHigh, policy: normalizedPolicy });

  const { versionRows, noteRows, renderRows, lifecycleReadError } = await getQuoteLifecycle({ id, tenantId });

  const activeVersion = typeof (rowSnap as any).currentVersion === "number" ? Number((rowSnap as any).currentVersion) : null;

  const renderedRenders = (renderRows ?? []).filter((r: any) => String(r.status ?? "") === "rendered" && Boolean(r.imageUrl));

  const submittedAtLabel = rowSnap.createdAt ? new Date(rowSnap.createdAt).toLocaleString() : "—";

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
      <QuoteHeader
        quoteId={id}
        submittedAtLabel={submittedAtLabel}
        isRead={isRead}
        stageLabel={stageLabel}
        stageNorm={String(stageNorm)}
        stages={STAGES.map((s) => ({ key: s.key, label: s.label }))}
        stageIndex={stageIndex}
        stagePct={stagePct}
        renderStatus={rowSnap.renderStatus}
        confidence={confidence}
        inspectionRequired={inspectionRequired}
        activeVersion={activeVersion}
        markUnreadAction={markUnreadAction}
        markReadAction={markReadAction}
      />

      <div className="space-y-6">
        <LeadCard quoteId={id} lead={lead} stageNorm={String(stageNorm)} setStageAction={setStageAction as any} />

        <CustomerNotesCard notes={notes} />
        <QuotePhotoGallery photos={photos} />

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

        <EmailBuilderPanel
          quoteId={id}
          activeVersion={activeVersion}
          versionRows={versionRows as any}
          renderedRenders={renderedRenders as any}
          customerPhotos={(photos as any[]) ?? []}
        />

        {/* ✅ Sent emails card (composer history) */}
        <SentEmailsCard tenantId={tenantId} quoteId={id} />

        <div id="renders" />

        <LifecyclePanelServer
          quoteId={id}
          versionRows={versionRows}
          noteRows={noteRows}
          renderRows={renderRows}
          lifecycleReadError={lifecycleReadError}
          activeVersion={activeVersion}
        />

        <LegacyRenderPanel
          renderStatus={rowSnap.renderStatus}
          renderedAt={rowSnap.renderedAt}
          renderImageUrl={rowSnap.renderImageUrl ? String(rowSnap.renderImageUrl) : null}
          renderError={rowSnap.renderError ? String(rowSnap.renderError) : null}
          renderPrompt={rowSnap.renderPrompt ? String(rowSnap.renderPrompt) : null}
        />
      </div>

      <details className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950/40">
        <summary className="cursor-pointer select-none text-sm font-semibold text-gray-700 dark:text-gray-200">
          Debug / raw payload
          <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">(collapsed by default)</span>
        </summary>
        <div className="mt-4">
          <RawPayloadPanel input={rowSnap.input ?? {}} />
        </div>
      </details>

      <div id="lifecycle" />
    </div>
  );
}