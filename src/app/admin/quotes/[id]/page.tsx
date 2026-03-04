// src/app/admin/quotes/[id]/page.tsx
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import QuoteHeader from "@/components/admin/quote/QuoteHeader";
import QuoteIntakeCard from "@/components/admin/quote/QuoteIntakeCard";
import LifecyclePanelServer from "@/components/admin/quote/LifecyclePanelServer";
import EmailBuilderPanel from "@/components/admin/quote/EmailBuilderPanel";
import EmailHistoryCard, { type EmailHistoryRow } from "@/components/admin/quote/EmailHistoryCard";
import RawPayloadPanel from "@/components/admin/quote/RawPayloadPanel";
import LegacyRenderPanel from "@/components/admin/quote/LegacyRenderPanel";

import RenderProgressBar from "@/components/admin/quote/RenderProgressBar";
import RenderAutoFocus from "@/components/admin/quote/RenderAutoFocus";

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
  pickLead,
  pickPhotos,
} from "@/lib/admin/quotes/pageCompat";

import { safeMoney } from "@/lib/admin/quotes/utils";

// ✅ server actions (module exports only)
import { markReadAction, markUnreadAction, setStageAction } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }> | { id: string };
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

function normalizeEmailRows(rows: any[]): EmailHistoryRow[] {
  const xs = Array.isArray(rows) ? rows : [];
  return xs.map((r: any) => ({
    id: String(r?.id ?? ""),
    kind: String(r?.kind ?? "composer"),
    toEmails: Array.isArray(r?.to_emails) ? r.to_emails.map((x: any) => String(x)) : [],
    subject: r?.subject != null ? String(r.subject) : null,
    provider: r?.provider != null ? String(r.provider) : null,
    providerMessageId: r?.provider_message_id != null ? String(r.provider_message_id) : null,
    ok: Boolean(r?.ok),
    error: r?.error != null ? String(r.error) : null,
    createdAt: r?.created_at ?? null,
  }));
}

function safeEstimateDisplayText(v: any): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const t = String((v as any).text ?? "").trim();
    if (t) return t;
    const l = String((v as any).label ?? "").trim();
    if (l) return l;
  }
  return "—";
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

  const inputAny: any = rowSnap.input ?? {};
  const pricingPolicySnap: any = inputAny?.pricing_policy_snapshot ?? null;

  const normalizedPolicy = normalizePricingPolicy(pricingPolicySnap ?? null);
  const estimateDisplayAny = formatEstimateForPolicy({ estLow, estHigh, policy: normalizedPolicy });
  const estimateDisplayText = safeEstimateDisplayText(estimateDisplayAny);

  const { versionRows, noteRows, renderRows, lifecycleReadError } = await getQuoteLifecycle({ id, tenantId });

  const activeVersion =
    typeof (rowSnap as any).currentVersion === "number" ? Number((rowSnap as any).currentVersion) : null;

  const renderedRenders = (renderRows ?? []).filter((r: any) => String(r.status ?? "") === "rendered" && Boolean(r.imageUrl));

  // ✅ rendering activity signals (for progress + auto-focus)
  const queuedCount = (renderRows ?? []).filter((r: any) => String(r.status ?? "") === "queued").length;
  const runningCount = (renderRows ?? []).filter((r: any) => String(r.status ?? "") === "running").length;
  const renderingActive = queuedCount + runningCount > 0;

  const submittedAtLabel = rowSnap.createdAt ? new Date(rowSnap.createdAt).toLocaleString() : "—";

  // Email history (best-effort; table may not exist everywhere yet)
  let emailRows: EmailHistoryRow[] = [];
  try {
    const r = await db.execute(sql`
      select id, kind, to_emails, subject, provider, provider_message_id, ok, error, created_at
      from quote_email_sends
      where tenant_id = ${tenantId}::uuid
        and quote_log_id = ${id}::uuid
      order by created_at desc
      limit 50
    `);

    const rowsAny: any[] = (r as any)?.rows ?? (Array.isArray(r) ? (r as any) : []);
    emailRows = normalizeEmailRows(rowsAny);
  } catch {
    emailRows = [];
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
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
        markUnreadAction={markUnreadAction}
        markReadAction={markReadAction}
      />

      {/* SECTION 1: Intake */}
      <QuoteIntakeCard
        quoteId={id}
        lead={lead}
        notes={notes}
        photos={photos}
        stageNorm={String(stageNorm)}
        setStageAction={setStageAction as any}
        estimateDisplay={estimateDisplayText}
        confidence={confidence}
        inspectionRequired={inspectionRequired}
        summary={summary}
        questions={questions}
        assumptions={assumptions}
        visibleScope={visibleScope}
      />

      {/* ✅ If rendering is active, auto-focus the renders section once */}
      <RenderAutoFocus active={renderingActive} targetId="renders" />

      {/* SECTION 2: Renders */}
      <div id="renders" className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950/40">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">Renders</div>
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              Request new renders, preview results, and multi-select for email.
            </div>
          </div>
        </div>

        {/* ✅ Your render progress bar (focused + sticky-feeling) */}
        <RenderProgressBar active={renderingActive} queuedCount={queuedCount} runningCount={runningCount} />

        <div className="mt-4">
          <LifecyclePanelServer
            quoteId={id}
            versionRows={versionRows}
            noteRows={noteRows}
            renderRows={renderRows}
            lifecycleReadError={lifecycleReadError}
            activeVersion={activeVersion}
          />
        </div>
      </div>

      {/* SECTION 3: Sent emails */}
      <EmailHistoryCard quoteId={id} emails={emailRows} />

      {/* SECTION 4: Compose */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950/40">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">Compose</div>
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              Build an email using selected renders, then send when you’re ready.
            </div>
          </div>
        </div>

        <div className="mt-4">
          <EmailBuilderPanel
            quoteId={id}
            activeVersion={activeVersion}
            versionRows={versionRows as any}
            renderedRenders={renderedRenders as any}
            customerPhotos={(Array.isArray(photos) ? (photos as any[]) : []) ?? []}
          />
        </div>
      </div>

      {/* Advanced */}
      <details className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950/40">
        <summary className="cursor-pointer select-none text-sm font-semibold text-gray-700 dark:text-gray-200">
          Advanced / debug
          <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">(collapsed by default)</span>
        </summary>

        <div className="mt-4 space-y-6">
          <LegacyRenderPanel
            renderStatus={rowSnap.renderStatus}
            renderedAt={rowSnap.renderedAt}
            renderImageUrl={rowSnap.renderImageUrl ? String(rowSnap.renderImageUrl) : null}
            renderError={rowSnap.renderError ? String(rowSnap.renderError) : null}
            renderPrompt={rowSnap.renderPrompt ? String(rowSnap.renderPrompt) : null}
          />

          <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Raw payload</div>
            <RawPayloadPanel input={rowSnap.input ?? {}} />
          </div>
        </div>
      </details>
    </div>
  );
}