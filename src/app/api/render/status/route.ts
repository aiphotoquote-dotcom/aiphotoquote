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

export async function POST(req: Request) {
  const debugId = crypto.randomBytes(6).toString("hex");

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

    // Try new render columns first
    let row: any = null;
    let hasCols = true;

    try {
      const rNew = await db.execute(sql`
        select
          id,
          tenant_id,
          output,
          render_status,
          render_image_url,
          render_error
        from quote_logs
        where id = ${quoteLogId}::uuid
        limit 1
      `);
      row = (rNew as any)?.rows?.[0] ?? (Array.isArray(rNew) ? (rNew as any)[0] : null);
    } catch {
      hasCols = false;
      const rOld = await db.execute(sql`
        select id, tenant_id, output
        from quote_logs
        where id = ${quoteLogId}::uuid
        limit 1
      `);
      row = (rOld as any)?.rows?.[0] ?? (Array.isArray(rOld) ? (rOld as any)[0] : null);
    }

    if (!row) return json({ ok: false, error: "QUOTE_NOT_FOUND" }, 404, debugId);
    if (String(row.tenant_id) !== String(tenantId)) {
      return json({ ok: false, error: "TENANT_MISMATCH" }, 403, debugId);
    }

    if (hasCols) {
      const status = String(row.render_status ?? "idle");
      const imageUrl = row.render_image_url ? String(row.render_image_url) : null;
      const error = row.render_error ? String(row.render_error) : null;

      return json(
        {
          ok: true,
          quoteLogId,
          status,
          imageUrl,
          error,
        },
        200,
        debugId
      );
    }

    // Fallback: read output.rendering
    const out = safeJsonParse(row.output) ?? {};
    const r = out?.rendering ?? null;

    const status = String(r?.status ?? "idle");
    const imageUrl = r?.imageUrl ? String(r.imageUrl) : null;
    const error = r?.error ? String(r.error) : null;

    return json(
      {
        ok: true,
        quoteLogId,
        status,
        imageUrl,
        error,
      },
      200,
      debugId
    );
  } catch (e: any) {
    return json(
      { ok: false, error: "REQUEST_FAILED", message: e?.message ?? String(e) },
      500,
      crypto.randomBytes(6).toString("hex")
    );
  }
}
