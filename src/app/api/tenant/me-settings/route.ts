import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

/**
 * We don't want to "hunt" for the exact cookie name.
 * This supports the common variants used in the app so far.
 */
function getActiveTenantIdFromCookies(): string | null {
  const c = cookies();

  const candidates = [
    "active_tenant_id",
    "activeTenantId",
    "tenant_id",
    "tenantId",
    "apq_active_tenant_id",
  ];

  for (const name of candidates) {
    const v = c.get(name)?.value?.trim();
    if (v) return v;
  }

  return null;
}

export async function GET() {
  try {
    const tenantId = getActiveTenantIdFromCookies();

    if (!tenantId) {
      return json(
        {
          ok: false,
          error: { code: "NO_ACTIVE_TENANT", message: "No active tenant selected." },
        },
        401
      );
    }

    // Try "new" schema first (includes ai_rendering_enabled)
    try {
      const r = await db.execute(sql`
        select
          tenant_id,
          industry_key,
          redirect_url,
          thank_you_url,
          ai_rendering_enabled,
          ai_rendering_copy,
          ai_rendering_disclaimer,
          updated_at
        from tenant_settings
        where tenant_id = ${tenantId}::uuid
        limit 1
      `);

      const row: any =
        (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

      return json({
        ok: true,
        tenantId,
        settings: row ?? null,
        meta: { schema: "new" },
      });
    } catch (e: any) {
      // Fallback for prod DBs missing new columns
      const r = await db.execute(sql`
        select
          tenant_id,
          industry_key,
          redirect_url,
          thank_you_url,
          updated_at
        from tenant_settings
        where tenant_id = ${tenantId}::uuid
        limit 1
      `);

      const row: any =
        (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

      return json({
        ok: true,
        tenantId,
        settings: row ? { ...row, ai_rendering_enabled: false } : null,
        meta: { schema: "fallback" },
      });
    }
  } catch (err: any) {
    return json(
      {
        ok: false,
        error: {
          code: "INTERNAL",
          message: err?.message ?? String(err),
        },
      },
      500
    );
  }
}
