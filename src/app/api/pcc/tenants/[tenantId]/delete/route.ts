// src/app/api/pcc/tenants/[tenantId]/delete/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Params = z.object({
  tenantId: z.string().uuid(),
});

function rows(r: any): any[] {
  return (r as any)?.rows ?? (Array.isArray(r) ? r : []);
}

async function countWhereTenantId(table: string, tenantId: string): Promise<number> {
  // NOTE: table names are controlled constants in code (not user input)
  const q = sql`SELECT count(*)::int AS c FROM ${sql.raw(table)} WHERE tenant_id = ${tenantId}::uuid`;
  const r = await db.execute(q as any).catch(() => null);
  const rr = r ? rows(r) : [];
  const c = rr?.[0]?.c;
  return typeof c === "number" ? c : Number(c ?? 0);
}

async function countWhereId(table: string, tenantId: string): Promise<number> {
  // NOTE: table names are controlled constants in code (not user input)
  const q = sql`SELECT count(*)::int AS c FROM ${sql.raw(table)} WHERE id = ${tenantId}::uuid`;
  const r = await db.execute(q as any).catch(() => null);
  const rr = r ? rows(r) : [];
  const c = rr?.[0]?.c;
  return typeof c === "number" ? c : Number(c ?? 0);
}

export async function GET(_: Request, ctx: { params: Promise<{ tenantId: string }> | { tenantId: string } }) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const p = await ctx.params;
  const parsed = Params.safeParse({ tenantId: String((p as any)?.tenantId ?? "") });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_TENANT_ID" }, { status: 400 });
  }
  const tenantId = parsed.data.tenantId;

  // Preview counts (keep this list aligned with your real schema)
  const counts = {
    tenants: await countWhereId("tenants", tenantId),
    tenantSettings: await countWhereTenantId("tenant_settings", tenantId),
    tenantSecrets: await countWhereTenantId("tenant_secrets", tenantId),
    tenantMembers: await countWhereTenantId("tenant_members", tenantId),
    tenantPricingRules: await countWhereTenantId("tenant_pricing_rules", tenantId),
    tenantSubIndustries: await countWhereTenantId("tenant_sub_industries", tenantId),
    tenantEmailIdentities: await countWhereTenantId("tenant_email_identities", tenantId),
    quoteLogs: await countWhereTenantId("quote_logs", tenantId),

    // PCC/control-plane tables (from pccSchema)
    tenantPlans: await countWhereTenantId("tenant_plans", tenantId),
    tenantUsageMonthly: await countWhereTenantId("tenant_usage_monthly", tenantId),
    auditEvents: await countWhereTenantId("audit_events", tenantId),
  };

  return NextResponse.json({ ok: true, tenantId, counts });
}

/**
 * DELETE is intentionally POSTed by the UI as "delete" action
 * to avoid accidental deletes via prefetch/crawlers.
 */
export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string }> | { tenantId: string } }) {
  await requirePlatformRole(["platform_owner", "platform_admin"]); // tighter gate for destructive action

  const p = await ctx.params;
  const parsed = Params.safeParse({ tenantId: String((p as any)?.tenantId ?? "") });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_TENANT_ID" }, { status: 400 });
  }
  const tenantId = parsed.data.tenantId;

  const body = await req.json().catch(() => null);
  const confirm = String(body?.confirm ?? "").trim();

  // UI should send something like: confirm = "delete:<tenantId>"
  const expected = `delete:${tenantId}`;
  if (confirm !== expected) {
    return NextResponse.json(
      { ok: false, error: "CONFIRMATION_REQUIRED", expected },
      { status: 400 }
    );
  }

  // Transactional delete in safe order (children first), then tenant
  await db.transaction(async (tx: any) => {
    // tenant-scoped child tables
    await tx.execute(sql`DELETE FROM ${sql.raw("quote_logs")} WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM ${sql.raw("tenant_email_identities")} WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM ${sql.raw("tenant_pricing_rules")} WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM ${sql.raw("tenant_sub_industries")} WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM ${sql.raw("tenant_members")} WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM ${sql.raw("tenant_secrets")} WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM ${sql.raw("tenant_settings")} WHERE tenant_id = ${tenantId}::uuid`);

    // PCC/control-plane
    await tx.execute(sql`DELETE FROM ${sql.raw("tenant_usage_monthly")} WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM ${sql.raw("tenant_plans")} WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM ${sql.raw("audit_events")} WHERE tenant_id = ${tenantId}::uuid`);

    // finally the tenant row
    await tx.execute(sql`DELETE FROM ${sql.raw("tenants")} WHERE id = ${tenantId}::uuid`);
  });

  return NextResponse.json({ ok: true, deletedTenantId: tenantId });
}