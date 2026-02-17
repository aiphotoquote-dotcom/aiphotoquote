// src/app/api/quote/render/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import crypto from "crypto";

import { db } from "@/lib/db/client";
import { tenants, quoteLogs } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Req = z.object({
  tenantSlug: z.string().min(3),
  quoteLogId: z.string().uuid(),
});

function json(data: any, status = 200, debugId?: string) {
  const res = NextResponse.json(debugId ? { debugId, ...data } : data, { status });
  if (debugId) res.headers.set("x-debug-id", debugId);
  return res;
}

function safeErr(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e ?? "Unknown error");
  return msg.slice(0, 2000);
}

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

/**
 * ✅ IMPORTANT:
 * Prefer the *actual* request host over VERCEL_URL.
 * VERCEL_URL can be a deployment URL that is protected (401), which breaks the kick.
 */
function getBaseUrl(req: Request) {
  const envBase = safeTrim(process.env.NEXT_PUBLIC_APP_URL) || safeTrim(process.env.APP_URL);
  if (envBase) return envBase.replace(/\/+$/, "");

  // Prefer host headers (public domain) before VERCEL_URL
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`.replace(/\/+$/, "");

  const vercel = safeTrim(process.env.VERCEL_URL);
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;

  return "";
}

async function getTenantBySlug(tenantSlug: string) {
  const rows = await db
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.slug, tenantSlug))
    .limit(1);
  return rows[0] ?? null;
}

function pickJsonRow(r: any) {
  return (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
}

// If there is already a queued/running job, return it instead of inserting a new one
async function findExistingQueuedJob(quoteLogId: string): Promise<{ id: string; status: string } | null> {
  const r = await db.execute(sql`
    select id, status
    from render_jobs
    where quote_log_id = ${quoteLogId}::uuid
      and status in ('queued','running')
    order by created_at desc
    limit 1
  `);

  const row: any = pickJsonRow(r);
  if (!row) return null;
  return { id: String(row.id), status: String(row.status) };
}

async function enqueueRenderJob(args: { tenantId: string; quoteLogId: string; prompt: string }) {
  const jobId = crypto.randomUUID();
  await db.execute(sql`
    insert into render_jobs (id, tenant_id, quote_log_id, status, prompt, created_at)
    values (
      ${jobId}::uuid,
      ${args.tenantId}::uuid,
      ${args.quoteLogId}::uuid,
      'queued',
      ${args.prompt},
      now()
    )
  `);
  return jobId;
}

type NormalizedQa = Array<{ question: string; answer: string }>;

function normalizeQaAnswers(qaAny: any): NormalizedQa {
  const answers = qaAny?.answers;
  if (!Array.isArray(answers)) return [];
  return answers
    .map((x: any) => ({
      question: safeTrim(x?.question),
      answer: safeTrim(x?.answer),
    }))
    .filter((x) => x.question && x.answer);
}

function buildRenderPrompt(args: {
  tenantSlug: string;
  quoteLogId: string;
  inputAny: any;
  qaAny: any;
  outputAny: any;
}) {
  const { tenantSlug, quoteLogId, inputAny, qaAny, outputAny } = args;

  const ctx = inputAny?.customer_context ?? {};
  const category = safeTrim(ctx?.category) || safeTrim(inputAny?.industryKeySnapshot) || "service";
  const serviceType = safeTrim(ctx?.service_type) || "service";
  const notes = safeTrim(ctx?.notes);

  const summary = safeTrim(outputAny?.summary);
  const visibleScope = Array.isArray(outputAny?.visible_scope) ? outputAny.visible_scope.map(safeTrim).filter(Boolean) : [];

  const qaPairs = normalizeQaAnswers(qaAny);
  const qaText = qaPairs.length
    ? qaPairs.map((x) => `Q: ${x.question}\nA: ${x.answer}`).join("\n\n")
    : "";

  const styleKey =
    safeTrim(outputAny?.ai_snapshot?.tenantSettings?.tenantStyleKey) ||
    safeTrim(outputAny?.ai_snapshot?.tenantSettings?.tenantStyle) ||
    safeTrim(inputAny?.tenantStyleKey) ||
    "photoreal";

  const renderNotes =
    safeTrim(outputAny?.ai_snapshot?.tenantSettings?.tenantRenderNotes) ||
    safeTrim(inputAny?.tenantRenderNotes) ||
    "";

  const lines: string[] = [];

  lines.push(
    `You are generating a customer-facing visual concept render for an AI Photo Quote.`,
    `Tenant: ${tenantSlug}`,
    `Quote: ${quoteLogId}`,
    ``,
    `Goal: Create a realistic "after" concept image that matches the requested work and constraints.`,
    `Do NOT invent project details that are not stated below. If something is unclear, keep it generic rather than hallucinating.`,
    `No text overlays, no labels, no watermarks.`,
    ``
  );

  lines.push(`Service context:`);
  lines.push(`- Category: ${category}`);
  lines.push(`- Service type: ${serviceType}`);
  if (notes) lines.push(`- Customer notes: ${notes}`);
  if (summary) lines.push(`- Estimate summary: ${summary}`);

  if (visibleScope.length) {
    lines.push(``);
    lines.push(`Visible scope to reflect in the render:`);
    for (const s of visibleScope.slice(0, 12)) lines.push(`- ${s}`);
  }

  if (qaText) {
    lines.push(``);
    lines.push(`Follow-up Q&A (must be honored):`);
    lines.push(qaText);
  }

  lines.push(``);
  lines.push(`Rendering style: ${styleKey}`);
  if (renderNotes) {
    lines.push(`Tenant render notes: ${renderNotes}`);
  }

  lines.push(``);
  lines.push(
    `Output: a single high-quality image matching the requested concept. Keep it plausible and consistent with typical materials and construction for this category.`
  );

  return lines.join("\n");
}

/**
 * ✅ Immediate “kick” of the cron worker.
 * Hard timeout so we never hang the customer flow.
 * Returns debug info so we can see if it actually hit the right URL and auth worked.
 */
async function tryKickCronNow(req: Request) {
  const secret = safeTrim(process.env.CRON_SECRET);
  if (!secret) return { attempted: false as const, ok: false, reason: "missing_cron_secret" as const };

  const baseUrl = getBaseUrl(req);
  if (!baseUrl) return { attempted: false as const, ok: false, reason: "missing_base_url" as const };

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
      attempted: true as const,
      ok: Boolean(r.ok),
      reason: r.ok ? "ok" : "cron_http_error",
      url,
      status: r.status,
      bodySnippet,
    };
  } catch (e: any) {
    return {
      attempted: true as const,
      ok: false,
      reason: e?.name === "AbortError" ? "timeout" : "fetch_error",
      url,
    };
  } finally {
    clearTimeout(t);
  }
}

export async function POST(req: Request) {
  const debugId = `dbg_${Math.random().toString(36).slice(2, 10)}`;

  try {
    const body = await req.json().catch(() => null);
    const parsed = Req.safeParse(body);
    if (!parsed.success) {
      return json(
        { ok: false, error: "BAD_REQUEST", message: "Invalid payload", issues: parsed.error.issues },
        400,
        debugId
      );
    }

    const { tenantSlug, quoteLogId } = parsed.data;

    // 1) Resolve tenant
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return json({ ok: false, error: "TENANT_NOT_FOUND", message: "Invalid tenant link." }, 404, debugId);

    // 2) Verify quote belongs to tenant (and read opt-in / current status)
    const q = await db
      .select({
        id: quoteLogs.id,
        tenantId: quoteLogs.tenantId,
        renderOptIn: quoteLogs.renderOptIn,
        renderStatus: quoteLogs.renderStatus,
        renderImageUrl: quoteLogs.renderImageUrl,
        input: quoteLogs.input,
        qa: quoteLogs.qa,
        output: quoteLogs.output,
      })
      .from(quoteLogs)
      .where(and(eq(quoteLogs.id, quoteLogId), eq(quoteLogs.tenantId, tenant.id)))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!q) {
      return json({ ok: false, error: "QUOTE_NOT_FOUND", message: "Quote not found for this tenant." }, 404, debugId);
    }

    const inputAny: any = (q as any).input ?? {};
    const qaAny: any = (q as any).qa ?? {};
    const outputAny: any = (q as any).output ?? {};

    /**
     * ✅ Opt-in source of truth:
     * - quote_logs.render_opt_in is the fast column used by UI
     * - BUT older/newer flows may have stored the actual customer opt-in in input.render_opt_in
     *   (especially if the phase1 logic gated the column)
     *
     * We treat either as "opted in".
     */
    const optInFromColumn = Boolean(q.renderOptIn);
    const optInFromInput = Boolean(inputAny?.render_opt_in);
    const optedIn = optInFromColumn || optInFromInput;

    // Self-heal: if input says opted-in but column is false, update column.
    if (optInFromInput && !optInFromColumn) {
      await db
        .update(quoteLogs)
        .set({ renderOptIn: true })
        .where(and(eq(quoteLogs.id, quoteLogId), eq(quoteLogs.tenantId, tenant.id)));
    }

    // If not opted-in, do not enqueue
    if (!optedIn) {
      return json(
        {
          ok: true,
          quoteLogId,
          status: "not_requested",
          jobId: null,
          imageUrl: q.renderImageUrl ?? null,
          optIn: { column: optInFromColumn, input: optInFromInput, effective: optedIn },
        },
        200,
        debugId
      );
    }

    // If an image URL exists, treat as rendered and never enqueue/stomp.
    if (q.renderImageUrl) {
      return json(
        {
          ok: true,
          quoteLogId,
          status: "rendered",
          jobId: null,
          imageUrl: q.renderImageUrl,
          optIn: { column: optInFromColumn, input: optInFromInput, effective: optedIn },
        },
        200,
        debugId
      );
    }

    // 3) Idempotency: if queued/running exists, return it
    const existing = await findExistingQueuedJob(quoteLogId);
    if (existing) {
      // keep quote log status aligned (helps UI/admin)
      if (q.renderStatus !== "running" && q.renderStatus !== "queued") {
        await db
          .update(quoteLogs)
          .set({ renderStatus: existing.status === "running" ? "running" : "queued" })
          .where(and(eq(quoteLogs.id, quoteLogId), eq(quoteLogs.tenantId, tenant.id)));
      }

      const kick = await tryKickCronNow(req);

      return json(
        {
          ok: true,
          quoteLogId,
          status: existing.status === "running" ? "running" : "queued",
          jobId: existing.id,
          skipped: true,
          optIn: { column: optInFromColumn, input: optInFromInput, effective: optedIn },
          kick,
        },
        200,
        debugId
      );
    }

    // 4) Enqueue job with a REAL prompt (includes summary/scope/Q&A)
    const prompt = buildRenderPrompt({
      tenantSlug,
      quoteLogId,
      inputAny,
      qaAny,
      outputAny,
    });

    const jobId = await enqueueRenderJob({ tenantId: tenant.id, quoteLogId, prompt });

    // 5) Reflect queued status on quote log for UI/admin visibility
    await db
      .update(quoteLogs)
      .set({ renderStatus: "queued", renderError: null })
      .where(and(eq(quoteLogs.id, quoteLogId), eq(quoteLogs.tenantId, tenant.id)));

    const kick = await tryKickCronNow(req);

    return json(
      {
        ok: true,
        quoteLogId,
        status: "queued",
        jobId,
        optIn: { column: optInFromColumn, input: optInFromInput, effective: optedIn },
        kick,
      },
      200,
      debugId
    );
  } catch (e) {
    return json({ ok: false, error: "REQUEST_FAILED", message: safeErr(e) }, 500, debugId);
  }
}