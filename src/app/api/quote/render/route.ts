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

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
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

    // Read a tiny bit for debugging (don’t throw if it fails)
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
      })
      .from(quoteLogs)
      .where(and(eq(quoteLogs.id, quoteLogId), eq(quoteLogs.tenantId, tenant.id)))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!q) {
      return json({ ok: false, error: "QUOTE_NOT_FOUND", message: "Quote not found for this tenant." }, 404, debugId);
    }

    // If not opted-in, do not enqueue
    if (!q.renderOptIn) {
      return json(
        { ok: true, quoteLogId, status: "not_requested", jobId: null, imageUrl: q.renderImageUrl ?? null },
        200,
        debugId
      );
    }

    // If an image URL exists, treat as rendered and never enqueue/stomp.
    if (q.renderImageUrl) {
      return json({ ok: true, quoteLogId, status: "rendered", jobId: null, imageUrl: q.renderImageUrl }, 200, debugId);
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
          kick,
        },
        200,
        debugId
      );
    }

    // 4) Enqueue job
    const prompt = "queued_by_api_quote_render";
    const jobId = await enqueueRenderJob({ tenantId: tenant.id, quoteLogId, prompt });

    // 5) Reflect queued status on quote log for UI/admin visibility
    await db
      .update(quoteLogs)
      .set({ renderStatus: "queued", renderError: null })
      .where(and(eq(quoteLogs.id, quoteLogId), eq(quoteLogs.tenantId, tenant.id)));

    const kick = await tryKickCronNow(req);

    return json({ ok: true, quoteLogId, status: "queued", jobId, kick }, 200, debugId);
  } catch (e) {
    return json({ ok: false, error: "REQUEST_FAILED", message: safeErr(e) }, 500, debugId);
  }
}