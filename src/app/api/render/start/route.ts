// src/app/api/render/start/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import crypto from "crypto";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";

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

function safeJsonParse(v: any) {
  try {
    if (v == null) return null;
    if (typeof v === "object") return v;
    if (typeof v === "string") return JSON.parse(v);
    return v;
  } catch {
    return null;
  }
}

async function getTenantBySlug(tenantSlug: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug)).limit(1);
  return rows[0] ?? null;
}

async function findExistingQueuedJob(quoteLogId: string): Promise<{ id: string; status: string } | null> {
  try {
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
  } catch {
    return null;
  }
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

export async function POST(req: Request) {
  const debugId = crypto.randomBytes(6).toString("hex");
  const startedAt = Date.now();

  try {
    const raw = await req.json().catch(() => null);
    const parsed = Req.safeParse(raw);
    if (!parsed.success) {
      return json({ ok: false, error: "BAD_REQUEST_VALIDATION", issues: parsed.error.issues }, 400, debugId);
    }

    const { tenantSlug, quoteLogId } = parsed.data;

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return json({ ok: false, error: "TENANT_NOT_FOUND" }, 404, debugId);
    const tenantId = (tenant as any).id as string;

    // If already queued/running, no enqueue
    const existing = await findExistingQueuedJob(quoteLogId);
    if (existing) {
      return json(
        { ok: true, quoteLogId, status: existing.status, jobId: existing.id, skipped: true, durationMs: Date.now() - startedAt },
        200,
        debugId
      );
    }

    // We store prompt in job as a *seed*; cron will rebuild final prompt from PCC for canonical behavior
    const prompt = "queued_by_api_render_start";

    const jobId = await enqueueRenderJob({ tenantId, quoteLogId, prompt });

    return json(
      { ok: true, quoteLogId, status: "queued", jobId, durationMs: Date.now() - startedAt },
      200,
      debugId
    );
  } catch (e: any) {
    return json({ ok: false, error: "REQUEST_FAILED", message: e?.message ?? String(e) }, 500, debugId);
  }
}