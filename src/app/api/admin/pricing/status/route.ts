// src/app/api/admin/pricing/status/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requireTenantRole } from "@/lib/auth/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      pragma: "no-cache",
      expires: "0",
    },
  });
}

function firstRow(r: any): any | null {
  return (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
}

export async function GET() {
  const gate = await requireTenantRole(["owner", "admin", "member"]);
  if (!gate.ok) return json({ ok: false, error: gate.error, message: gate.message }, gate.status);

  // Pricing rules presence + basic completeness
  const r = await db.execute(sql`
    select
      id,
      min_job,
      typical_low,
      typical_high,
      max_without_inspection
    from tenant_pricing_rules
    where tenant_id = ${gate.tenantId}::uuid
    order by created_at desc nulls last
    limit 1
  `);

  const row = firstRow(r);

  const exists = Boolean(row?.id);

  const typicalLow = row?.typical_low ?? null;
  const typicalHigh = row?.typical_high ?? null;

  // “configured” = row exists AND typical_low + typical_high valid and ordered
  const configured =
    exists &&
    typeof typicalLow === "number" &&
    typeof typicalHigh === "number" &&
    isFinite(typicalLow) &&
    isFinite(typicalHigh) &&
    typicalHigh >= typicalLow;

  return json({
    ok: true,
    tenantId: gate.tenantId,
    role: gate.role,
    pricing: {
      exists,
      configured,
      fields: {
        minJob: row?.min_job ?? null,
        typicalLow,
        typicalHigh,
        maxWithoutInspection: row?.max_without_inspection ?? null,
      },
    },
  });
}
