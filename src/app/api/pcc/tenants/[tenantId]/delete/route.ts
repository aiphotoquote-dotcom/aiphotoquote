// src/app/api/pcc/tenants/[tenantId]/delete/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";

import {
  tenants,
  tenantMembers,
  tenantSettings,
  tenantSecrets,
  tenantEmailIdentities,
  tenantSubIndustries,
  tenantPricingRules,
  quoteLogs,
} from "@/lib/db/schema";

import { auditEvents, tenantPlans, tenantUsageMonthly } from "@/lib/db/pccSchema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Params = z.object({
  tenantId: z.string().uuid(),
});

const DeleteBody = z.object({
  confirm: z.string().min(1),
});

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

async function countWhereTenantId(table: any, col: any, tenantId: string): Promise<number> {
  const r = await db
    .select({ c: sql<number>`count(*)` })
    .from(table)
    .where(eq(col, tenantId as any))
    .then((x) => Number(x?.[0]?.c ?? 0))
    .catch(() => 0);
  return r;
}

/**
 * GET:
 * - return preview of what will be deleted (counts by table + tenant identity)
 * - PCC RBAC required
 */
export async function GET(_req: Request, ctx: { params: { tenantId: string } }) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const parsed = Params.safeParse(ctx?.params);
  if (!parsed.success) return json({ ok: false, error: "BAD_TENANT_ID" }, 400);

  const tenantId = parsed.data.tenantId;

  const t = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      createdAt: tenants.createdAt,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId as any))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!t) return json({ ok: false, error: "TENANT_NOT_FOUND" }, 404);

  const counts = {
    tenantMembers: await countWhereTenantId(tenantMembers, tenantMembers.tenantId, tenantId),
    tenantSettings: await countWhereTenantId(tenantSettings, tenantSettings.tenantId, tenantId),
    tenantSecrets: await countWhereTenantId(tenantSecrets, tenantSecrets.tenantId, tenantId),
    tenantEmailIdentities: await countWhereTenantId(tenantEmailIdentities, tenantEmailIdentities.tenantId, tenantId),
    tenantSubIndustries: await countWhereTenantId(tenantSubIndustries, tenantSubIndustries.tenantId, tenantId),
    tenantPricingRules: await countWhereTenantId(tenantPricingRules, tenantPricingRules.tenantId, tenantId),
    quoteLogs: await countWhereTenantId(quoteLogs, quoteLogs.tenantId, tenantId),

    // PCC-side tables (if present in your DB; schema is already in repo)
    tenantPlans: await countWhereTenantId(tenantPlans, tenantPlans.tenantId, tenantId),
    tenantUsageMonthly: await countWhereTenantId(tenantUsageMonthly, tenantUsageMonthly.tenantId, tenantId),

    // audit events can be tenant-scoped
    auditEvents: await countWhereTenantId(auditEvents, auditEvents.tenantId, tenantId),
  };

  const confirmPhrase = `DELETE ${t.slug}`;

  return json({
    ok: true,
    tenant: t,
    counts,
    confirmPhrase,
    warning: "This will permanently delete the tenant and ALL associated data shown above.",
  });
}

/**
 * POST:
 * - requires confirm === `DELETE <tenantSlug>`
 * - deletes in a single transaction (best-effort ordering)
 * - PCC RBAC required
 */
export async function POST(req: Request, ctx: { params: { tenantId: string } }) {
  await requirePlatformRole(["platform_owner", "platform_admin"]);

  const parsed = Params.safeParse(ctx?.params);
  if (!parsed.success) return json({ ok: false, error: "BAD_TENANT_ID" }, 400);

  const tenantId = parsed.data.tenantId;

  const bodyJson = await req.json().catch(() => null);
  const body = DeleteBody.safeParse(bodyJson);
  if (!body.success) return json({ ok: false, error: "INVALID_BODY", issues: body.error.issues }, 400);

  const t = await db
    .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, tenantId as any))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!t) return json({ ok: false, error: "TENANT_NOT_FOUND" }, 404);

  const expected = `DELETE ${t.slug}`;
  if (body.data.confirm.trim() !== expected) {
    return json(
      {
        ok: false,
        error: "CONFIRM_MISMATCH",
        message: `Type exactly: ${expected}`,
      },
      400
    );
  }

  // Delete everything tenant-scoped in a transaction.
  // Even though many FKs have cascades, we delete explicitly for safety + clarity.
  await db.transaction(async (tx) => {
    // Tenant-scoped audit events (optional cleanup)
    await tx.delete(auditEvents).where(eq(auditEvents.tenantId, tenantId as any));

    // PCC tables
    await tx.delete(tenantUsageMonthly).where(eq(tenantUsageMonthly.tenantId, tenantId as any));
    await tx.delete(tenantPlans).where(eq(tenantPlans.tenantId, tenantId as any));

    // App tables
    await tx.delete(quoteLogs).where(eq(quoteLogs.tenantId, tenantId as any));
    await tx.delete(tenantPricingRules).where(eq(tenantPricingRules.tenantId, tenantId as any));
    await tx.delete(tenantSubIndustries).where(eq(tenantSubIndustries.tenantId, tenantId as any));
    await tx.delete(tenantEmailIdentities).where(eq(tenantEmailIdentities.tenantId, tenantId as any));
    await tx.delete(tenantSecrets).where(eq(tenantSecrets.tenantId, tenantId as any));
    await tx.delete(tenantSettings).where(eq(tenantSettings.tenantId, tenantId as any));
    await tx.delete(tenantMembers).where(eq(tenantMembers.tenantId, tenantId as any));

    // Finally the tenant row
    await tx.delete(tenants).where(eq(tenants.id, tenantId as any));

    // Record an audit event *platform-wide* (tenant now gone, but we can still record tenantId meta)
    await tx.insert(auditEvents).values({
      actorClerkUserId: "unknown", // If you want: wire in Clerk user id here later
      tenantId: tenantId as any,
      action: "pcc.tenant.deleted",
      meta: {
        tenantSlug: t.slug,
        tenantName: t.name,
      },
    } as any);
  });

  return json({ ok: true, deletedTenantId: tenantId, deletedTenantSlug: t.slug });
}