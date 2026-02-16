// src/app/api/admin/onboarding/pricing-model/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requireTenantRole } from "@/lib/auth/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

const PricingModel = z.enum([
  "flat_per_job",
  "hourly_plus_materials",
  "per_unit",
  "packages",
  "line_items",
  "inspection_only",
  "assessment_fee",
]);

const Body = z.object({
  pricing_model: PricingModel.nullable(),
});

export async function POST(req: Request) {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) return json({ ok: false, error: gate.error, message: gate.message }, gate.status);

  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, 400);
  }

  try {
    const pricing_model = parsed.data.pricing_model;

    const upd = await db.execute(sql`
      update tenant_settings
      set
        pricing_model = ${pricing_model},
        updated_at = now()
      where tenant_id = ${gate.tenantId}::uuid
      returning tenant_id, pricing_model
    `);

    const row: any = (upd as any)?.rows?.[0] ?? (Array.isArray(upd) ? (upd as any)[0] : null);

    if (!row?.tenant_id) {
      return json(
        { ok: false, error: "SETTINGS_MISSING", message: "Tenant settings row missing; cannot update pricing model." },
        500
      );
    }

    return json({
      ok: true,
      tenantId: gate.tenantId,
      role: gate.role,
      pricing_model: row.pricing_model ?? null,
    });
  } catch (e: any) {
    return json(
      {
        ok: false,
        error: "DB_WRITE_FAILED",
        message: e?.message ?? String(e),
        code: e?.code,
        detail: e?.detail,
        hint: e?.hint,
      },
      500
    );
  }
}