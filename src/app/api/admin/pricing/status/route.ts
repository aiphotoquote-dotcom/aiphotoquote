import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

async function getActiveTenantIdFromCookie(): Promise<string | null> {
  // Next 15 cookies() is async in some setups; keep it safe.
  const c = await cookies();

  const candidates = [
    "activeTenantId",
    "active_tenant_id",
    "ACTIVE_TENANT_ID",
    "tenantId",
    "tenant_id",
  ];

  for (const name of candidates) {
    const v = c.get(name)?.value?.trim();
    if (v) return v;
  }

  return null;
}

export async function GET() {
  // Clerk auth() can be async depending on version/runtime — always await for safety.
  const { userId } = await auth();

  if (!userId) {
    return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  }

  const tenantId = await getActiveTenantIdFromCookie();
  if (!tenantId) {
    return json(
      {
        ok: false,
        error: "NO_ACTIVE_TENANT",
        message: "No active tenant cookie found.",
      },
      400
    );
  }

  // Verify membership (RBAC guard)
  const mem = await db.execute(sql`
    select role
    from tenant_members
    where tenant_id = ${tenantId}::uuid
      and clerk_user_id = ${userId}
    limit 1
  `);

  const memRow: any =
    (mem as any)?.rows?.[0] ?? (Array.isArray(mem) ? (mem as any)[0] : null);

  if (!memRow) {
    return json(
      { ok: false, error: "FORBIDDEN", message: "Not a member of this tenant." },
      403
    );
  }

  // Pricing rules presence + basic completeness
  const r = await db.execute(sql`
    select
      id,
      min_job,
      typical_low,
      typical_high,
      max_without_inspection
    from tenant_pricing_rules
    where tenant_id = ${tenantId}::uuid
    order by created_at desc nulls last
    limit 1
  `);

  const row: any =
    (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

  const exists = Boolean(row?.id);

  const typicalLow = row?.typical_low ?? null;
  const typicalHigh = row?.typical_high ?? null;

  // Define “configured” as: row exists AND has typical_low + typical_high set.
  const configured =
    exists &&
    typeof typicalLow === "number" &&
    typeof typicalHigh === "number" &&
    isFinite(typicalLow) &&
    isFinite(typicalHigh) &&
    typicalHigh >= typicalLow;

  return json({
    ok: true,
    tenantId,
    role: memRow.role,
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
