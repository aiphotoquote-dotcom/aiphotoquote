// src/app/admin/quotes/[id]/actions.ts
"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { and, eq, sql, desc } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs, quoteNotes, quoteRenders, quoteVersions, tenantMembers } from "@/lib/db/schema";

import { resolveActiveTenantId } from "@/lib/admin/quotes/getActiveTenant";
import { adminReassessQuote } from "@/lib/quotes/adminReassess";
import {
  normalizeAiMode,
  normalizeEngine,
  type AdminReassessEngine,
  type QuoteLogRow,
} from "@/lib/admin/quotes/pageCompat";
import { safeTrim } from "@/lib/admin/quotes/utils";

/* -------------------- helpers -------------------- */

function safeTrimLocal(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function looksUuid(v: string) {
  const s = safeTrimLocal(v);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function parsePositiveInt(v: string) {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i >= 0 ? i : null;
}

function isHttpUrl(u: string) {
  const s = safeTrimLocal(u);
  if (!s) return false;
  try {
    const url = new URL(s);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function getBaseUrlFromEnv() {
  const envBase = safeTrimLocal(process.env.NEXT_PUBLIC_APP_URL) || safeTrimLocal(process.env.APP_URL);
  if (envBase) return envBase.replace(/\/+$/, "");

  const vercel = safeTrimLocal(process.env.VERCEL_URL);
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;

  return "http://localhost:3000";
}

async function inferQuoteIdFromReferer(): Promise<string | null> {
  // ✅ Next 16 typings: headers() can be Promise<ReadonlyHeaders>
  const h = await headers();
  const ref = safeTrimLocal(h.get("referer"));
  if (!ref) return null;

  // matches: /admin/quotes/<id> or /admin/quotes/<id>?x=y or /admin/quotes/<id>#hash
  const m = ref.match(/\/admin\/quotes\/([^/?#]+)(?:[/?#]|$)/i);
  if (!m?.[1]) return null;

  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

async function resolveQuoteIdOrRedirect(formData: FormData): Promise<string> {
  const q1 = safeTrim(formData.get("quote_id"));
  if (q1) return q1;

  const q2 = await inferQuoteIdFromReferer();
  if (q2) return q2;

  redirect("/admin/quotes");
}

async function ensureActiveMembership(actorUserId: string, tenantIdNow: string) {
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

  return Boolean(membership?.ok);
}

async function resolveTenantOrRedirect(actorUserId: string) {
  const jar = await cookies();
  const tenantIdMaybe = await resolveActiveTenantId({ jar, userId: actorUserId });
  if (!tenantIdMaybe) redirect("/admin/quotes");

  const tenantId = String(tenantIdMaybe);

  const okMember = await ensureActiveMembership(actorUserId, tenantId);
  if (!okMember) redirect("/admin/quotes");

  return tenantId;
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

async function ensureVersion0(args: { tenantId: string; quoteLogId: string; quoteOutput: any }) {
  const existing = await db
    .select({ id: quoteVersions.id, version: quoteVersions.version })
    .from(quoteVersions)
    .where(and(eq(quoteVersions.tenantId, args.tenantId), eq(quoteVersions.quoteLogId, args.quoteLogId)))
    .orderBy(desc(quoteVersions.createdAt))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (existing?.id) {
    return { created: false as const, versionId: String(existing.id), version: Number(existing.version ?? 0) };
  }

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
      ${args.tenantId}::uuid,
      ${args.quoteLogId}::uuid,
      0,
      ${JSON.stringify(args.quoteOutput ?? {})}::jsonb,
      'unknown',
      now()
    )
    returning id::text as "id"
  `);

  const versionId = (inserted as any)?.rows?.[0]?.id ? String((inserted as any).rows[0].id) : null;
  return { created: true as const, versionId, version: 0 };
}

/* -------------------- exported server actions -------------------- */

export async function setStageAction(formData: FormData) {
  const session = await auth();
  const actorUserId = session.userId;
  if (!actorUserId) redirect("/sign-in");

  const quoteId = await resolveQuoteIdOrRedirect(formData);
  const tenantId = await resolveTenantOrRedirect(actorUserId);

  const nextRaw = String(formData.get("stage") ?? "").trim().toLowerCase();

  const normalizeMod = await import("@/lib/admin/quotes/normalize");
  const STAGES = normalizeMod.STAGES;
  type StageKey = (typeof STAGES)[number]["key"];

  const allowed = new Set<StageKey>(STAGES.map((s) => s.key as StageKey));
  const next = nextRaw as StageKey;

  if (!allowed.has(next)) {
    redirect(`/admin/quotes/${encodeURIComponent(quoteId)}?stageError=invalid#lifecycle`);
  }

  await db
    .update(quoteLogs)
    .set({ stage: next } as any)
    .where(and(eq(quoteLogs.id, quoteId), eq(quoteLogs.tenantId, tenantId)));

  redirect(`/admin/quotes/${encodeURIComponent(quoteId)}`);
}

export async function markReadAction(formData: FormData) {
  const session = await auth();
  const actorUserId = session.userId;
  if (!actorUserId) redirect("/sign-in");

  const quoteId = await resolveQuoteIdOrRedirect(formData);
  const tenantId = await resolveTenantOrRedirect(actorUserId);

  await db
    .update(quoteLogs)
    .set({ isRead: true } as any)
    .where(and(eq(quoteLogs.id, quoteId), eq(quoteLogs.tenantId, tenantId)));

  redirect(`/admin/quotes/${encodeURIComponent(quoteId)}`);
}

export async function markUnreadAction(formData: FormData) {
  const session = await auth();
  const actorUserId = session.userId;
  if (!actorUserId) redirect("/sign-in");

  const quoteId = await resolveQuoteIdOrRedirect(formData);
  const tenantId = await resolveTenantOrRedirect(actorUserId);

  await db
    .update(quoteLogs)
    .set({ isRead: false } as any)
    .where(and(eq(quoteLogs.id, quoteId), eq(quoteLogs.tenantId, tenantId)));

  redirect(`/admin/quotes/${encodeURIComponent(quoteId)}?skipAutoRead=1`);
}

export async function createNewVersionAction(formData: FormData) {
  const session = await auth();
  const actorUserId = session.userId;
  if (!actorUserId) redirect("/sign-in");

  const quoteId = await resolveQuoteIdOrRedirect(formData);
  const tenantId = await resolveTenantOrRedirect(actorUserId);

  const engineUi = normalizeEngine(formData.get("engine"));
  const aiMode = normalizeAiMode(formData.get("ai_mode"));
  const reason = safeTrim(formData.get("reason"));
  const noteBody = safeTrim(formData.get("note_body"));

  const q = await db
    .select({
      id: quoteLogs.id,
      tenantId: quoteLogs.tenantId,
      input: quoteLogs.input,
      output: quoteLogs.output,
      qa: (quoteLogs as any).qa,
    })
    .from(quoteLogs)
    .where(and(eq(quoteLogs.id, quoteId), eq(quoteLogs.tenantId, tenantId)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!q?.id) redirect(`/admin/quotes/${encodeURIComponent(quoteId)}?reassessError=not_found#lifecycle`);

  let createdNoteId: string | null = null;
  if (noteBody) {
    const inserted = await db
      .insert(quoteNotes)
      .values({ tenantId, quoteLogId: quoteId, quoteVersionId: null, createdBy: actorUserId, body: noteBody } as any)
      .returning({ id: quoteNotes.id })
      .then((r) => r[0] ?? null);

    createdNoteId = inserted?.id ? String(inserted.id) : null;
  }

  const engine: AdminReassessEngine =
    engineUi === "full_ai_reassessment" ? "openai_assessment" : "deterministic_only";

  const quoteLog: QuoteLogRow = {
    id: quoteId,
    tenant_id: tenantId,
    input: (q as any).input ?? {},
    qa: (q as any).qa ?? {},
    output: (q as any).output ?? {},
  };

  const result = await adminReassessQuote({
    quoteLog,
    createdBy: actorUserId,
    engine,
    contextNotesLimit: 50,
    source: "admin.actions",
    reason: reason || undefined,
  });

  if (createdNoteId) {
    await db
      .update(quoteNotes)
      .set({ quoteVersionId: result.versionId } as any)
      .where(and(eq(quoteNotes.id, createdNoteId), eq(quoteNotes.tenantId, tenantId)));
  }

  void aiMode;
  redirect(`/admin/quotes/${encodeURIComponent(quoteId)}#lifecycle`);
}

export async function restoreVersionAction(formData: FormData) {
  const session = await auth();
  const actorUserId = session.userId;
  if (!actorUserId) redirect("/sign-in");

  const quoteId = await resolveQuoteIdOrRedirect(formData);
  const versionId = safeTrim(formData.get("version_id"));
  if (!versionId) redirect(`/admin/quotes/${encodeURIComponent(quoteId)}#lifecycle`);

  const tenantId = await resolveTenantOrRedirect(actorUserId);

  const updated = await db.execute(sql`
    with picked as (
      select v.output as output, v.version as version
      from quote_versions v
      where v.id = ${versionId}::uuid
        and v.tenant_id = ${tenantId}::uuid
        and v.quote_log_id = ${quoteId}::uuid
      limit 1
    )
    update quote_logs q
    set output = picked.output, current_version = picked.version
    from picked
    where q.id = ${quoteId}::uuid
      and q.tenant_id = ${tenantId}::uuid
    returning q.id::text as "id"
  `);

  const ok = Boolean((updated as any)?.rows?.[0]?.id);
  if (!ok) redirect(`/admin/quotes/${encodeURIComponent(quoteId)}?restoreError=1#lifecycle`);

  redirect(`/admin/quotes/${encodeURIComponent(quoteId)}#lifecycle`);
}

/**
 * ✅ Tenant initiated render:
 * - must bypass customer opt-in
 * - must be allowed even when customer quoteform renders are disabled
 * - must NOT send emails
 * - must NOT write back to quote_logs.render_* (customer-facing preview)
 */
export async function requestRenderAction(formData: FormData) {
  const session = await auth();
  const actorUserId = session.userId;
  if (!actorUserId) redirect("/sign-in");

  const quoteId = await resolveQuoteIdOrRedirect(formData);
  const tenantId = await resolveTenantOrRedirect(actorUserId);

  const shopNotes = safeTrim(formData.get("shop_notes"));

  /**
   * ✅ Base selection inputs (admin UI)
   * We support BOTH naming styles for safety:
   * - new: base_kind, base_url, base_render_id
   * - legacy: base_image_url, base_render_id
   */
  const baseKindRaw = safeTrim(formData.get("base_kind"));
  const baseUrlRawNew = safeTrim(formData.get("base_url"));
  const baseUrlRawLegacy = safeTrim(formData.get("base_image_url"));

  const baseRenderIdRaw = safeTrim(formData.get("base_render_id"));

  const baseKind = (baseKindRaw || "").toLowerCase();
  const baseUrlCandidate = baseUrlRawNew || baseUrlRawLegacy;

  const baseRenderId = baseRenderIdRaw && looksUuid(baseRenderIdRaw) ? baseRenderIdRaw : "";
  const baseUrl = baseUrlCandidate && isHttpUrl(baseUrlCandidate) ? baseUrlCandidate : "";

  type BaseMeta =
    | { kind: "customer_photo"; url: string; renderId: null }
    | { kind: "render"; url: string; renderId: string | null };

  let baseMeta: BaseMeta | null = null;

  // Normalize base kind
  const kindNorm =
    baseKind === "customer_photo" || baseKind === "customer" ? "customer_photo" : baseKind === "render" ? "render" : "none";

  if (kindNorm === "customer_photo") {
    // require url
    if (baseUrl) {
      baseMeta = { kind: "customer_photo", url: baseUrl, renderId: null };
    }
  } else if (kindNorm === "render") {
    // render base: allow either renderId OR url; if renderId provided, validate ownership
    if (baseRenderId) {
      // Validate base render belongs to THIS tenant + quote, and has an imageUrl (so evolution makes sense)
      const hit = await db
        .select({ id: quoteRenders.id, imageUrl: (quoteRenders as any).imageUrl })
        .from(quoteRenders)
        .where(and(eq(quoteRenders.tenantId, tenantId), eq(quoteRenders.quoteLogId, quoteId), eq(quoteRenders.id, baseRenderId as any)))
        .limit(1)
        .then((r) => r[0] ?? null);

      const img = safeTrimLocal((hit as any)?.imageUrl);
      if (hit?.id && img) {
        baseMeta = { kind: "render", renderId: baseRenderId, url: baseUrl || img };
      } else if (baseUrl) {
        // fall back: url-only, but only if valid
        baseMeta = { kind: "render", renderId: null, url: baseUrl };
      }
    } else if (baseUrl) {
      baseMeta = { kind: "render", renderId: null, url: baseUrl };
    }
  } else {
    baseMeta = null;
  }

  const q = await db
    .select({ output: quoteLogs.output })
    .from(quoteLogs)
    .where(and(eq(quoteLogs.id, quoteId), eq(quoteLogs.tenantId, tenantId)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!q) redirect(`/admin/quotes/${encodeURIComponent(quoteId)}?renderError=not_found#renders`);

  try {
    await ensureVersion0({ tenantId, quoteLogId: quoteId, quoteOutput: (q as any).output ?? {} });
  } catch {
    // ignore
  }

  const rawA = safeTrim(formData.get("version_id"));
  const rawB = safeTrim(formData.get("version_number"));
  const candidate = rawA || rawB;

  let resolvedVersionId: string | null = null;

  if (candidate && looksUuid(candidate)) {
    const hit = await db
      .select({ id: quoteVersions.id })
      .from(quoteVersions)
      .where(and(eq(quoteVersions.tenantId, tenantId), eq(quoteVersions.quoteLogId, quoteId), eq(quoteVersions.id, candidate)))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (hit?.id) resolvedVersionId = String(hit.id);
  }

  if (!resolvedVersionId) {
    const vnum = parsePositiveInt(candidate) ?? 0;
    const picked = await db
      .select({ id: quoteVersions.id })
      .from(quoteVersions)
      .where(and(eq(quoteVersions.tenantId, tenantId), eq(quoteVersions.quoteLogId, quoteId), eq(quoteVersions.version, vnum)))
      .orderBy(desc(quoteVersions.createdAt))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (picked?.id) resolvedVersionId = String(picked.id);
  }

  if (!resolvedVersionId) redirect(`/admin/quotes/${encodeURIComponent(quoteId)}?renderError=version_not_found#renders`);

  const maxAttemptRow = await db
    .select({ maxAttempt: sql<number>`coalesce(max(${quoteRenders.attempt}), 0)` })
    .from(quoteRenders)
    .where(and(eq(quoteRenders.tenantId, tenantId), eq(quoteRenders.quoteVersionId, resolvedVersionId!)))
    .limit(1)
    .then((r) => r[0] ?? null);

  const nextAttempt = Number(maxAttemptRow?.maxAttempt ?? 0) + 1;

  const inserted = await db
    .insert(quoteRenders)
    .values({
      tenantId,
      quoteLogId: quoteId,
      quoteVersionId: resolvedVersionId!,
      attempt: nextAttempt,
      status: "queued" as any,
      shopNotes: shopNotes || null,

      meta: {
        forceRender: true,
        suppressEmails: true,
        suppressLegacy: true,
        source: "tenant_admin",
        requestedBy: actorUserId,
        requestedAt: new Date().toISOString(),

        // ✅ base selection for evolution (customer photo or prior render)
        ...(baseMeta ? { base: baseMeta } : {}),
      },
    } as any)
    .returning({ id: quoteRenders.id })
    .then((r) => r[0] ?? null);

  if (!inserted?.id) redirect(`/admin/quotes/${encodeURIComponent(quoteId)}?renderError=insert_failed#renders`);

  const kick = await tryKickRenderCronNow();
  if (kick.attempted && !kick.ok) {
    redirect(
      `/admin/quotes/${encodeURIComponent(quoteId)}?renderWarn=cron_kick_failed&kick_reason=${encodeURIComponent(
        kick.reason
      )}&kick_status=${encodeURIComponent(String((kick as any).status ?? ""))}#renders`
    );
  }

  redirect(`/admin/quotes/${encodeURIComponent(quoteId)}#renders`);
}

export async function deleteVersionAction(formData: FormData) {
  const session = await auth();
  const actorUserId = session.userId;
  if (!actorUserId) redirect("/sign-in");

  const quoteId = await resolveQuoteIdOrRedirect(formData);
  const versionId = safeTrim(formData.get("version_id"));
  if (!versionId) redirect(`/admin/quotes/${encodeURIComponent(quoteId)}#lifecycle`);

  const tenantId = await resolveTenantOrRedirect(actorUserId);

  const v = await db
    .select({ version: quoteVersions.version })
    .from(quoteVersions)
    .where(
      and(
        eq(quoteVersions.id, versionId as any),
        eq(quoteVersions.tenantId, tenantId),
        eq(quoteVersions.quoteLogId, quoteId)
      )
    )
    .limit(1)
    .then((r) => r[0] ?? null);

  if (Number(v?.version ?? -1) === 0) {
    redirect(`/admin/quotes/${encodeURIComponent(quoteId)}?deleteError=cannot_delete_v0#lifecycle`);
  }

  await db
    .delete(quoteRenders)
    .where(and(eq(quoteRenders.tenantId, tenantId), eq(quoteRenders.quoteVersionId, versionId as any)));

  await db
    .update(quoteNotes)
    .set({ quoteVersionId: null } as any)
    .where(
      and(
        eq(quoteNotes.tenantId, tenantId),
        eq(quoteNotes.quoteLogId, quoteId),
        eq(quoteNotes.quoteVersionId, versionId as any)
      )
    );

  await db.delete(quoteVersions).where(and(eq(quoteVersions.tenantId, tenantId), eq(quoteVersions.id, versionId as any)));

  redirect(`/admin/quotes/${encodeURIComponent(quoteId)}#lifecycle`);
}

export async function deleteNoteAction(formData: FormData) {
  const session = await auth();
  const actorUserId = session.userId;
  if (!actorUserId) redirect("/sign-in");

  const quoteId = await resolveQuoteIdOrRedirect(formData);
  const noteId = safeTrim(formData.get("note_id"));
  if (!noteId) redirect(`/admin/quotes/${encodeURIComponent(quoteId)}#lifecycle`);

  const tenantId = await resolveTenantOrRedirect(actorUserId);

  await db.delete(quoteNotes).where(and(eq(quoteNotes.tenantId, tenantId), eq(quoteNotes.id, noteId as any)));
  redirect(`/admin/quotes/${encodeURIComponent(quoteId)}#lifecycle`);
}

export async function deleteRenderAction(formData: FormData) {
  const session = await auth();
  const actorUserId = session.userId;
  if (!actorUserId) redirect("/sign-in");

  const quoteId = await resolveQuoteIdOrRedirect(formData);
  const renderId = safeTrim(formData.get("render_id"));
  if (!renderId) redirect(`/admin/quotes/${encodeURIComponent(quoteId)}#renders`);

  const tenantId = await resolveTenantOrRedirect(actorUserId);

  await db.delete(quoteRenders).where(and(eq(quoteRenders.tenantId, tenantId), eq(quoteRenders.id, renderId as any)));
  redirect(`/admin/quotes/${encodeURIComponent(quoteId)}#renders`);
}