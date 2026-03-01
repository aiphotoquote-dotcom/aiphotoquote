// src/app/admin/quotes/[id]/page.tsx
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq, sql, desc } from "drizzle-orm";
import { redirect } from "next/navigation";

import QuotePhotoGallery from "@/components/admin/QuotePhotoGallery";

import CustomerNotesCard from "@/components/admin/quote/CustomerNotesCard";
import LifecyclePanel from "@/components/admin/quote/LifecyclePanel";
import DetailsPanel from "@/components/admin/quote/DetailsPanel";
import LegacyRenderPanel from "@/components/admin/quote/LegacyRenderPanel";
import RawPayloadPanel from "@/components/admin/quote/RawPayloadPanel";
import EmailBuilderPanel from "@/components/admin/quote/EmailBuilderPanel";

import { db } from "@/lib/db/client";
import { quoteNotes, quoteRenders, quoteVersions, tenantMembers, quoteLogs } from "@/lib/db/schema";

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
  return i >= 0 ? i : null;
}

function safeTrimLocal(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function getBaseUrlFromEnv() {
  const envBase = safeTrimLocal(process.env.NEXT_PUBLIC_APP_URL) || safeTrimLocal(process.env.APP_URL);
  if (envBase) return envBase.replace(/\/+$/, "");

  const vercel = safeTrimLocal(process.env.VERCEL_URL);
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;

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

async function ensureVersion0(args: { tenantId: string; quoteLogId: string; actorUserId: string; quoteOutput: any }) {
  const { tenantId, quoteLogId, quoteOutput } = args;

  const existing = await db
    .select({ id: quoteVersions.id, version: quoteVersions.version })
    .from(quoteVersions)
    .where(and(eq(quoteVersions.tenantId, tenantId), eq(quoteVersions.quoteLogId, quoteLogId)))
    .orderBy(desc(quoteVersions.createdAt))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (existing?.id) return { created: false as const, versionId: String(existing.id), version: Number(existing.version ?? 0) };

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

function chip(text: string, tone: "gray" | "blue" | "green" | "red" = "gray") {
  const base =
    "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold " +
    "dark:border-gray-800";
  const toneCls =
    tone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/40 dark:bg-blue-950/40 dark:text-blue-200"
      : tone === "green"
        ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/40 dark:bg-green-950/40 dark:text-green-200"
        : tone === "red"
          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200"
          : "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-200";
  return <span className={base + " " + toneCls}>{text}</span>;
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
    await db.update(quoteLogs).set({ isRead: true } as any).where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    isRead = true;
  }

  const lead = pickLead(rowSnap.input);
  const notes = pickCustomerNotes(rowSnap.input);
  const photos = pickPhotos(rowSnap.input);

  const stageNorm = normalizeStage(rowSnap.stage);

  const normalizeMod = await import("@/lib/admin/quotes/normalize");
  const STAGES = normalizeMod.STAGES;

  const stageMeta = STAGES.find((s) => s.key === stageNorm) ?? null;
  const stageLabel =
    stageNorm === "read" ? "Read (legacy)" : stageMeta?.label ?? "New";

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

  async function ensureActiveMembership(actorUserId: string, tenantIdNow: string) {
    const membership = await db
      .select({ ok: sql<number>`1` })
      .from(tenantMembers)
      .where(
        and(eq(tenantMembers.tenantId, tenantIdNow), eq(tenantMembers.clerkUserId, actorUserId), eq(tenantMembers.status, "active"))
      )
      .limit(1)
      .then((r) => r[0] ?? null);

    return Boolean(membership?.ok);
  }

  /* -------------------- server actions -------------------- */
  async function setStage(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session.userId) redirect("/sign-in");

    const next = String(formData.get("stage") ?? "").trim().toLowerCase();
    const allowed = new Set((await import("@/lib/admin/quotes/normalize")).STAGES.map((s) => s.key));
    if (!allowed.has(next as any)) redirect(`/admin/quotes/${encodeURIComponent(id)}`);

    await db.update(quoteLogs).set({ stage: next } as any).where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    redirect(`/admin/quotes/${encodeURIComponent(id)}`);
  }

  async function markUnread() {
    "use server";
    const session = await auth();
    if (!session.userId) redirect("/sign-in");

    await db.update(quoteLogs).set({ isRead: false } as any).where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
    redirect(`/admin/quotes/${encodeURIComponent(id)}?skipAutoRead=1`);
  }

  async function markRead() {
    "use server";
    const session = await auth();
    if (!session.userId) redirect("/sign-in");

    await db.update(quoteLogs).set({ isRead: true } as any).where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)));
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
        .values({ tenantId, quoteLogId: id, quoteVersionId: null, createdBy: actorUserId, body: noteBody } as any)
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

    const okMember = await ensureActiveMembership(actorUserId, tenantId);
    if (!okMember) redirect(`/admin/quotes/${encodeURIComponent(id)}`);

    const updated = await db.execute(sql`
      with picked as (
        select v.output as output, v.version as version
        from quote_versions v
        where v.id = ${versionId}::uuid
          and v.tenant_id = ${tenantId}::uuid
          and v.quote_log_id = ${id}::uuid
        limit 1
      )
      update quote_logs q
      set output = picked.output, current_version = picked.version
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

    const okMember = await ensureActiveMembership(actorUserId, tenantIdNow);
    if (!okMember) redirect(`/admin/quotes/${encodeURIComponent(id)}?renderError=forbidden#renders`);

    const shopNotes = safeTrim(formData.get("shop_notes"));

    try {
      await ensureVersion0({ tenantId: tenantIdNow, quoteLogId: id, actorUserId, quoteOutput: rowSnap.output ?? {} });
    } catch {
      // ignore
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
        .where(and(eq(quoteVersions.tenantId, tenantIdNow), eq(quoteVersions.quoteLogId, id), eq(quoteVersions.id, candidate)))
        .limit(1)
        .then((r) => r[0] ?? null);

      if (hit?.id) {
        resolvedVersionId = String(hit.id);
        resolvedVersionNumber = Number(hit.version ?? null);
      }
    }

    if (!resolvedVersionId) {
      const vnum = parsePositiveInt(candidate) ?? 0;
      const picked = await db
        .select({ id: quoteVersions.id, version: quoteVersions.version })
        .from(quoteVersions)
        .where(and(eq(quoteVersions.tenantId, tenantIdNow), eq(quoteVersions.quoteLogId, id), eq(quoteVersions.version, vnum)))
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
          )}&available_versions=${encodeURIComponent(availableVersions.join(","))}&activeTenant=${encodeURIComponent(tenantIdNow)}#renders`
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
        `/admin/quotes/${encodeURIComponent(
          id
        )}?renderError=insert_failed&activeTenant=${encodeURIComponent(tenantIdNow)}&version=${encodeURIComponent(
          String(resolvedVersionNumber ?? "")
        )}#renders`
      );
    }

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
      {/* ✅ HEADER (server-rendered; no function props into Client Components) */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <a href="/admin/quotes" className="text-sm font-semibold text-gray-600 hover:underline dark:text-gray-300">
              ← Back to quotes
            </a>

            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Quote</h1>
              {chip(stageLabel, "blue")}
              {activeVersion != null ? chip(`active v${activeVersion}`, "green") : chip("no active version", "gray")}
              {isRead ? chip("READ", "gray") : chip("UNREAD", "red")}
            </div>

            <div className="text-xs text-gray-600 dark:text-gray-300">
              <span className="font-mono break-all">{id}</span>
              <span className="mx-2 opacity-60">·</span>
              Submitted: <span className="font-mono">{submittedAtLabel}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <form action={markUnread}>
              <button
                type="submit"
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
              >
                Mark unread
              </button>
            </form>

            <form action={markRead}>
              <button
                type="submit"
                className="rounded-lg bg-black px-3 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                Mark read
              </button>
            </form>
          </div>
        </div>

        {/* ✅ Progress bar */}
        <div className="mt-5">
          <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-300">
            <div className="font-semibold">Progress</div>
            <div className="font-mono">{stagePct}%</div>
          </div>

          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-900">
            <div className="h-full bg-black dark:bg-white" style={{ width: `${stagePct}%` }} />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {STAGES.slice(0, 8).map((s, idx) => {
              const isDone = idx < stageIndex;
              const isActive = idx === stageIndex;
              const tone: any = isActive ? "blue" : isDone ? "green" : "gray";
              return <span key={s.key}>{chip(s.label, tone)}</span>;
            })}
          </div>

          {/* ✅ Stage control */}
          <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Stage</div>
            <form action={setStage} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                name="stage"
                defaultValue={String(stageNorm)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
              >
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label} ({s.key})
                  </option>
                ))}
              </select>

              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                Update stage
              </button>
            </form>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* Lead summary (data-only; no actions passed) */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Lead</div>
            {lead?.name ? chip(String(lead.name), "gray") : chip("unknown", "gray")}
          </div>

          <div className="mt-3 grid gap-2 text-sm text-gray-700 dark:text-gray-200">
            {lead?.email ? (
              <div>
                <span className="font-semibold">Email:</span> <span className="font-mono">{String(lead.email)}</span>
              </div>
            ) : null}
            {lead?.phone ? (
              <div>
                <span className="font-semibold">Phone:</span> <span className="font-mono">{String(lead.phone)}</span>
              </div>
            ) : null}
          </div>
        </div>

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
          // ✅ delete actions intentionally NOT passed from this page
          // (prevents “function passed to Client Component” crashes)
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