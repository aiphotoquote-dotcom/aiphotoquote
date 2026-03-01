// src/app/admin/quotes/[id]/page.tsx
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq, sql, desc } from "drizzle-orm";
import { redirect } from "next/navigation";

import QuotePhotoGallery from "@/components/admin/QuotePhotoGallery";

import QuoteHeader from "@/components/admin/quote/QuoteHeader";
import LeadCard from "@/components/admin/quote/LeadCard";
import CustomerNotesCard from "@/components/admin/quote/CustomerNotesCard";
import LifecyclePanel from "@/components/admin/quote/LifecyclePanel";
import DetailsPanel from "@/components/admin/quote/DetailsPanel";
import LegacyRenderPanel from "@/components/admin/quote/LegacyRenderPanel";
import RawPayloadPanel from "@/components/admin/quote/RawPayloadPanel";
import EmailBuilderPanel from "@/components/admin/quote/EmailBuilderPanel";

import { db } from "@/lib/db/client";
import { quoteLogs, quoteNotes, quoteRenders, quoteVersions, tenantMembers } from "@/lib/db/schema";

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

function looksUuid(v: string) {
  const s = safeTrim(v);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
function parsePositiveInt(v: string) {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i > 0 ? i : null;
}

function safeTrimLocal(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

/**
 * ✅ Free Vercel pattern:
 * We can’t rely on scheduled cron, so we “kick” the worker immediately
 * after enqueue by calling /api/cron/render?max=1 with CRON_SECRET.
 */
function getBaseUrlFromEnv() {
  const envBase = safeTrimLocal(process.env.NEXT_PUBLIC_APP_URL) || safeTrimLocal(process.env.APP_URL);
  if (envBase) return envBase.replace(/\/+$/, "");

  const vercel = safeTrimLocal(process.env.VERCEL_URL);
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;

  // local dev fallback
  return "http://localhost:3000";
}

async function tryKickRenderCronNow(): Promise<
  | { attempted: false; ok: false; reason: "missing_cron_secret" | "missing_base_url" }
  | { attempted: true; ok: boolean; reason: string; status?: number; bodySnippet?: string | null; url: string }
> {
  const secret = safeTrimLocal(process.env.CRON_SECRET);
  if (!secret) return { attempted: false, ok: false, reason: "missing_cron_secret" };

  const baseUrl = getBaseUrlFromEnv();
  if (!baseUrl) return { attempted: false, ok: false, reason: "missing_base_url" };

  const url = `${baseUrl}/api/cron/render?max=1`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 1750);

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: controller.signal,
    });

    let bodySnippet: string | null = null;
    try {
      const txt = await r.text();
      bodySnippet = txt ? txt.slice(0, 200) : "";
    } catch {
      bodySnippet = null;
    }

    return {
      attempted: true,
      ok: Boolean(r.ok),
      reason: r.ok ? "ok" : "cron_http_error",
      url,
      status: r.status,
      bodySnippet,
    };
  } catch (e: any) {
    return {
      attempted: true,
      ok: false,
      reason: e?.name === "AbortError" ? "timeout" : "fetch_error",
      url,
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * ✅ Ensure we always have a “v0” so lifecycle renders can attach to something.
 * This makes “original quote = version0” true.
 */
async function ensureVersion0(args: {
  tenantId: string;
  quoteLogId: string;
  actorUserId: string;
  quoteOutput: any;
}) {
  const { tenantId, quoteLogId, quoteOutput } = args;

  // If any version exists, do nothing.
  const existing = await db
    .select({ id: quoteVersions.id, version: quoteVersions.version })
    .from(quoteVersions)
    .where(and(eq(quoteVersions.tenantId, tenantId), eq(quoteVersions.quoteLogId, quoteLogId)))
    .orderBy(desc(quoteVersions.createdAt))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (existing?.id) return { created: false as const, versionId: String(existing.id), version: Number(existing.version ?? 0) };

  // Try to create v0 with raw SQL so we don’t get blocked by schema typing drift.
  // We only reference columns we *know* exist from your cron loader: (id, tenant_id, quote_log_id, version, output, ai_mode).
  const inserted = await db.execute(sql`
    insert into quote_versions (
      id,
      tenant_id,
      quote_log_id,
      version,
      output,
      ai_mode,
      created_at
    )
    values (
      gen_random_uuid(),
      ${tenantId}::uuid,
      ${quoteLogId}::uuid,
      0,
      ${JSON.stringify(quoteOutput ?? {})}::jsonb,
      'unknown',
      now()
    )
    returning id::text as "id"
  `);

  const versionId = (inserted as any)?.rows?.[0]?.id ? String((inserted as any).rows[0].id) : null;
  if (!versionId) return { created: false as const, versionId: null as any, version: null as any };

  // Best-effort: mark current_version=0 on quote_logs (helps the “ACTIVE” concept)
  try {
    await db.execute(sql`
      update quote_logs
      set current_version = 0
      where id = ${quoteLogId}::uuid
        and tenant_id = ${tenantId}::uuid
    `);
  } catch {
    // ignore
  }

  return { created: true as const, versionId, version: 0 };
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
    sp?.skipAutoRead === "1" || (Array.isArray(sp?.skipAutoRead) && sp.skipAutoRead.includes("1"));

  const jar = await cookies();

  const tenantIdMaybe = await resolveActiveTenantId({ jar, userId });
  if (!tenantIdMaybe) redirect("/admin/quotes");
  const tenantId: string = tenantIdMaybe;

  let row = await getAdminQuoteRow({ id, tenantId });

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
  const stageLabel =
    stageNorm === "read"
      ? "Read (legacy)"
      : (await import("@/lib/admin/quotes/normalize")).STAGES.find((s) => s.key === stageNorm)?.label ?? "New";

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

  const pricingBasis: any =
    aiAssessment?.pricing_basis ?? outAny?.pricing_basis ?? outAny?.output?.pricing_basis ?? null;

  const inputAny: any = rowSnap.input ?? {};
  const pricingPolicySnap: any = inputAny?.pricing_policy_snapshot ?? null;
  const pricingConfigSnap: any = inputAny?.pricing_config_snapshot ?? null;
  const pricingRulesSnap: any = inputAny?.pricing_rules_snapshot ?? null;

  const industryKeySnap = pickIndustryKeySnapshot(inputAny);
  const llmKeySource = pickLlmKeySource(inputAny);

  const normalizedPolicy = normalizePricingPolicy(pricingPolicySnap ?? null);
  const estimateDisplay = formatEstimateForPolicy({ estLow, estHigh, policy: normalizedPolicy });

  const { versionRows, noteRows, renderRows, lifecycleReadError } = await getQuoteLifecycle({ id, tenantId });

  const activeVersion =
    typeof (rowSnap as any).currentVersion === "number" ? Number((rowSnap as any).currentVersion) : null;

  // ✅ Only rendered attempts (for email builder)
  const renderedRenders = (renderRows ?? []).filter(
    (r: any) => String(r.status ?? "") === "rendered" && Boolean(r.imageUrl)
  );

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

    const engine: AdminReassessEngine =
      engineUi === "full_ai_reassessment" ? "openai_assessment" : "deterministic_only";

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
        and(
          eq(tenantMembers.tenantId, tenantId),
          eq(tenantMembers.clerkUserId, actorUserId),
          eq(tenantMembers.status, "active")
        )
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

    const jarNow = await cookies();
    const tenantIdNowMaybe = await resolveActiveTenantId({ jar: jarNow, userId: actorUserId });
    if (!tenantIdNowMaybe) redirect(`/admin/quotes/${encodeURIComponent(id)}?renderError=no_active_tenant#renders`);
    const tenantIdNow = String(tenantIdNowMaybe);

    const membership = await db
      .select({ ok: sql<number>`1` })
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.tenantId, tenantIdNow),
          eq(tenantMembers.clerkUserId, actorUserId),
          eq(tenantMembers.status, "active")
        )
      )
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!membership?.ok) redirect(`/admin/quotes/${encodeURIComponent(id)}?renderError=forbidden#renders`);

    const shopNotes = safeTrim(formData.get("shop_notes"));

    // ✅ Ensure we have version0 at least (original quote snapshot)
    // Uses quote_logs.output (current) as the v0 output.
    try {
      await ensureVersion0({
        tenantId: tenantIdNow,
        quoteLogId: id,
        actorUserId,
        quoteOutput: rowSnap.output ?? {},
      });
    } catch {
      // ignore; we’ll still attempt normal resolution below
    }

    const rawA = safeTrim(formData.get("version_id"));
    const rawB = safeTrim(formData.get("version_number"));
    const candidate = rawA || rawB;

    let resolvedVersionId: string | null = null;
    let resolvedVersionNumber: number | null = null;

    if (looksUuid(candidate)) {
      const hit = await db
        .select({ id: quoteVersions.id, version: quoteVersions.version })
        .from(quoteVersions)
        .where(
          and(eq(quoteVersions.tenantId, tenantIdNow), eq(quoteVersions.quoteLogId, id), eq(quoteVersions.id, candidate))
        )
        .limit(1)
        .then((r) => r[0] ?? null);

      if (hit?.id) {
        resolvedVersionId = String(hit.id);
        resolvedVersionNumber = Number(hit.version ?? null);
      }
    }

    if (!resolvedVersionId) {
      const vnum = parsePositiveInt(candidate) ?? 0; // ✅ allow v0
      const picked = await db
        .select({ id: quoteVersions.id, version: quoteVersions.version })
        .from(quoteVersions)
        .where(
          and(eq(quoteVersions.tenantId, tenantIdNow), eq(quoteVersions.quoteLogId, id), eq(quoteVersions.version, vnum))
        )
        .orderBy(desc(quoteVersions.createdAt))
        .limit(1)
        .then((r) => r[0] ?? null);

      if (picked?.id) {
        resolvedVersionId = String(picked.id);
        resolvedVersionNumber = vnum;
      } else {
        const avail = await db
          .select({ version: quoteVersions.version })
          .from(quoteVersions)
          .where(and(eq(quoteVersions.tenantId, tenantIdNow), eq(quoteVersions.quoteLogId, id)))
          .orderBy(desc(quoteVersions.version))
          .limit(50);

        const availableVersions = avail
          .map((x) => Number(x.version))
          .filter((n) => Number.isFinite(n))
          .sort((a, b) => a - b);

        redirect(
          `/admin/quotes/${encodeURIComponent(id)}?renderError=version_number_not_found&version_number=${encodeURIComponent(
            String(vnum)
          )}&available_versions=${encodeURIComponent(availableVersions.join(","))}&activeTenant=${encodeURIComponent(
            tenantIdNow
          )}#renders`
        );
      }
    }

    const maxAttemptRow = await db
      .select({ maxAttempt: sql<number>`coalesce(max(${quoteRenders.attempt}), 0)` })
      .from(quoteRenders)
      .where(and(eq(quoteRenders.tenantId, tenantIdNow), eq(quoteRenders.quoteVersionId, resolvedVersionId!)))
      .limit(1)
      .then((r) => r[0] ?? null);

    const nextAttempt = Number(maxAttemptRow?.maxAttempt ?? 0) + 1;

    const inserted = await db
      .insert(quoteRenders)
      .values({
        tenantId: tenantIdNow,
        quoteLogId: id,
        quoteVersionId: resolvedVersionId!,
        attempt: nextAttempt,
        status: "queued" as any,
        shopNotes: shopNotes || null,
      } as any)
      .returning({ id: quoteRenders.id })
      .then((r) => r[0] ?? null);

    const ok = Boolean(inserted?.id);
    if (!ok) {
      redirect(
        `/admin/quotes/${encodeURIComponent(id)}?renderError=insert_failed&activeTenant=${encodeURIComponent(
          tenantIdNow
        )}&version=${encodeURIComponent(String(resolvedVersionNumber ?? ""))}#renders`
      );
    }

    // ✅ Immediately kick the worker (Free Vercel “no schedule” approach)
    const kick = await tryKickRenderCronNow();
    if (kick.attempted && !kick.ok) {
      redirect(
        `/admin/quotes/${encodeURIComponent(id)}?renderWarn=cron_kick_failed&kick_reason=${encodeURIComponent(
          kick.reason
        )}&kick_status=${encodeURIComponent(String((kick as any).status ?? ""))}#renders`
      );
    }

    redirect(`/admin/quotes/${encodeURIComponent(id)}#renders`);
  }

  const submittedAtLabel = rowSnap.createdAt ? new Date(rowSnap.createdAt).toLocaleString() : "—";

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
        markUnreadAction={markUnread}
        markReadAction={markRead}
      />

      {/* ✅ Single-column stacked layout (v1) */}
      <div className="space-y-6">
        <LeadCard lead={lead} stageNorm={String(stageNorm)} setStageAction={setStage} />

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

        {/* ✅ The “wow” step: pick version + images + template, then open composer pre-filled */}
        <EmailBuilderPanel
          quoteId={id}
          activeVersion={activeVersion}
          versionRows={versionRows as any}
          renderedRenders={renderedRenders as any}
          customerPhotos={(photos as any[]) ?? []}
        />

        {/* Anchor for “#renders” */}
        <div id="renders" />

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

        <LegacyRenderPanel
          renderStatus={rowSnap.renderStatus}
          renderedAt={rowSnap.renderedAt}
          renderImageUrl={rowSnap.renderImageUrl ? String(rowSnap.renderImageUrl) : null}
          renderError={rowSnap.renderError ? String(rowSnap.renderError) : null}
          renderPrompt={rowSnap.renderPrompt ? String(rowSnap.renderPrompt) : null}
        />
      </div>

      {/* ✅ Debug moved out of the way */}
      <details className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950/40">
        <summary className="cursor-pointer select-none text-sm font-semibold text-gray-700 dark:text-gray-200">
          Debug / raw payload
          <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">(collapsed by default)</span>
        </summary>
        <div className="mt-4">
          <RawPayloadPanel input={rowSnap.input ?? {}} />
        </div>
      </details>
    </div>
  );
}