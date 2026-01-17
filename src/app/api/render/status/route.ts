import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import crypto from "crypto";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Q = z.object({
  tenantSlug: z.string().min(3),
  quoteLogId: z.string().uuid(),
});

function json(data: any, status = 200, debugId?: string) {
  const res = NextResponse.json(debugId ? { debugId, ...data } : data, { status });
  if (debugId) res.headers.set("x-debug-id", debugId);
  return res;
}

async function getTenantBySlug(tenantSlug: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug)).limit(1);
  return rows[0] ?? null;
}

export async function GET(req: Request) {
  const debugId = crypto.randomBytes(6).toString("hex");

  try {
    const url = new URL(req.url);
    const raw = {
      tenantSlug: url.searchParams.get("tenantSlug"),
      quoteLogId: url.searchParams.get("quoteLogId"),
    };

    const parsed = Q.safeParse(raw);
    if (!parsed.success) {
      return json(
        { ok: false, error: "BAD_REQUEST_VALIDATION", issues: parsed.error.issues, received: raw },
        400,
        debugId
      );
    }

    const { tenantSlug, quoteLogId } = parsed.data;

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return json({ ok: false, error: "TENANT_NOT_FOUND" }, 404, debugId);
    const tenantId = (tenant as any).id as string;

    const r = await db.execute(`
      select id, tenant_id, quote_log_id, status, image_url, error, created_at, started_at, completed_at
      from render_jobs
      where quote_log_id = '${quoteLogId}'::uuid
      limit 1
    ` as any);

    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

    if (!row) {
      return json(
        { ok: true, quoteLogId, status: "not_found" },
        200,
        debugId
      );
    }

    if (String(row.tenant_id) !== String(tenantId)) {
      return json({ ok: false, error: "TENANT_MISMATCH" }, 403, debugId);
    }

    return json(
      {
        ok: true,
        quoteLogId,
        jobId: String(row.id),
        status: String(row.status ?? "queued"),
        imageUrl: row.image_url ? String(row.image_url) : null,
        error: row.error ? String(row.error) : null,
        timestamps: {
          createdAt: row.created_at ? String(row.created_at) : null,
          startedAt: row.started_at ? String(row.started_at) : null,
          completedAt: row.completed_at ? String(row.completed_at) : null,
        },
      },
      200,
      debugId
    );
  } catch (err: any) {
    return json(
      { ok: false, error: "REQUEST_FAILED", message: err?.message ?? String(err) },
      500,
      crypto.randomBytes(6).toString("hex")
    );
  }
}
