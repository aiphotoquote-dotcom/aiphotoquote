// src/app/api/pcc/tenants/[tenantId]/delete/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";
import {
  tenants,
  quoteLogs,
  tenantMembers,
  tenantSettings,
  tenantSubIndustries,
  tenantEmailIdentities,
  tenantPricingRules,
  tenantSecrets,
} from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Params = z.object({
  tenantId: z.string().uuid(),
});

const DeleteBody = z.object({
  confirm: z.string().min(1),
});

function rows(r: any): any[] {
  return (r as any)?.rows ?? (Array.isArray(r) ? r : []);
}

async function countByTenantId(table: "quote_logs" | "tenant_members" | "tenant_settings" | "tenant_sub_industries" | "tenant_email_identities" | "tenant_pricing_rules" | "tenant_secrets", tenantId: string) {
  // NOTE: table names are controlled constants here (not user input)
  // We still avoid sql.raw + bind tricks; use direct SQL per table.
  switch (table) {
    case "quote_logs": {
      const r = await db.execute(
        sql`select count(*)::int as c from quote_logs where tenant_id = ${tenantId}::uuid`
      );
      return Number(rows(r)?.[0]?.c ?? 0);
    }
    case "tenant_members": {
      const r = await db.execute(
        sql`select count(*)::int as c from tenant_members where tenant_id = ${tenantId}::uuid`
      );
      return Number(rows(r)?.[0]?.c ?? 0);
    }
    case "tenant_settings": {
      const r = await db.execute(
        sql`select count(*)::int as c from tenant_settings where tenant_id = ${tenantId}::uuid`
      );
      return Number(rows(r)?.[0]?.c ?? 0);
    }
    case "tenant_sub_industries": {
      const r = await db.execute(
        sql`select count(*)::int as c from tenant_sub_industries where tenant_id = ${tenantId}::uuid`
      );
      return Number(rows(r)?.[0]?.c ?? 0);
    }
    case "tenant_email_identities": {
      const r = await db.execute(
        sql`select count(*)::int as c from tenant_email_identities where tenant_id = ${tenantId}::uuid`
      );
      return Number(rows(r)?.[0]?.c ?? 0);
    }
    case "tenant_pricing_rules": {
      const r = await db.execute(
        sql`select count(*)::int as c from tenant_pricing_rules where tenant_id = ${tenantId}::uuid`
      );
      return Number(rows(r)?.[0]?.c ?? 0);
    }
    case "tenant_secrets": {
      const r = await db.execute(
        sql`select count(*)::int as c from tenant_secrets where tenant_id = ${tenantId}::uuid`
      );
      return Number(rows(r)?.[0]?.c ?? 0);
    }
    default:
      return 0;
  }
}

async function loadTenant(tenantId: string) {
  const t = await db
    .select({ id: tenants.id, name: tenants.name, slug: tenants.slug, createdAt: tenants.createdAt })
    .from(tenants)
    .where(sql`${tenants.id} = ${tenantId}::uuid`)
    .limit(1)
    .then((r) => r[0] ?? null);

  return t;
}

function buildConfirmStrings(t: { id: string; slug: string }) {
  const id8 = String(t.id).slice(0, 8);
  return {
    confirmA: `DELETE ${t.slug}`,
    confirmB: `DELETE ${id8}`,
  };
}

/**
 * GET: Preview tenant + counts (safe for platform_support too)
 */
export async function GET(_req: Request, ctx: { params: Promise<{ tenantId: string }> | { tenantId: string } }) {
  try {
    await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

    const p = await ctx.params;
    const parsed = Params.safeParse(p);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "BAD_TENANT_ID" }, { status: 400 });
    }

    const tenantId = parsed.data.tenantId;

    const t = await loadTenant(tenantId);
    if (!t) {
      return NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND" }, { status: 404 });
    }

    const [
      quotesCount,
      membersCount,
      settingsCount,
      subIndustriesCount,
      identitiesCount,
      pricingRulesCount,
      secretsCount,
    ] = await Promise.all([
      countByTenantId("quote_logs", tenantId),
      countByTenantId("tenant_members", tenantId),
      countByTenantId("tenant_settings", tenantId),
      countByTenantId("tenant_sub_industries", tenantId),
      countByTenantId("tenant_email_identities", tenantId),
      countByTenantId("tenant_pricing_rules", tenantId),
      countByTenantId("tenant_secrets", tenantId),
    ]);

    const confirm = buildConfirmStrings({ id: String(t.id), slug: String(t.slug) });

    return NextResponse.json(
      {
        ok: true,
        tenant: {
          id: String(t.id),
          name: String(t.name),
          slug: String(t.slug),
          createdAt: t.createdAt ?? null,
        },
        counts: {
          quoteLogs: quotesCount,
          tenantMembers: membersCount,
          tenantSettings: settingsCount,
          tenantSubIndustries: subIndustriesCount,
          tenantEmailIdentities: identitiesCount,
          tenantPricingRules: pricingRulesCount,
          tenantSecrets: secretsCount,
        },
        confirm,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

/**
 * POST: Delete tenant (platform_owner/admin only), requires typed confirmation.
 * Transactional + child->parent delete order.
 */
export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string }> | { tenantId: string } }) {
  try {
    await requirePlatformRole(["platform_owner", "platform_admin"]);

    const p = await ctx.params;
    const parsed = Params.safeParse(p);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "BAD_TENANT_ID" }, { status: 400 });
    }
    const tenantId = parsed.data.tenantId;

    const bodyJson = await req.json().catch(() => null);
    const b = DeleteBody.safeParse(bodyJson);
    if (!b.success) {
      return NextResponse.json({ ok: false, error: "BAD_BODY", issues: b.error.issues }, { status: 400 });
    }

    const t = await loadTenant(tenantId);
    if (!t) {
      return NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND" }, { status: 404 });
    }

    const { confirmA, confirmB } = buildConfirmStrings({ id: String(t.id), slug: String(t.slug) });
    const typed = String(b.data.confirm ?? "").trim();

    if (typed !== confirmA && typed !== confirmB) {
      return NextResponse.json(
        {
          ok: false,
          error: "CONFIRMATION_MISMATCH",
          message: `Type exactly "${confirmA}" (or "${confirmB}") to confirm.`,
        },
        { status: 400 }
      );
    }

    // Transactional delete — safe even if DB lacks ON DELETE CASCADE on some FKs.
    await db.transaction(async (tx: any) => {
      await tx.delete(quoteLogs).where(sql`${quoteLogs.tenantId} = ${tenantId}::uuid`);
      await tx.delete(tenantSecrets).where(sql`${tenantSecrets.tenantId} = ${tenantId}::uuid`);
      await tx.delete(tenantEmailIdentities).where(sql`${tenantEmailIdentities.tenantId} = ${tenantId}::uuid`);
      await tx.delete(tenantPricingRules).where(sql`${tenantPricingRules.tenantId} = ${tenantId}::uuid`);
      await tx.delete(tenantSubIndustries).where(sql`${tenantSubIndustries.tenantId} = ${tenantId}::uuid`);
      await tx.delete(tenantSettings).where(sql`${tenantSettings.tenantId} = ${tenantId}::uuid`);
      await tx.delete(tenantMembers).where(sql`${tenantMembers.tenantId} = ${tenantId}::uuid`);

      // Finally delete tenant
      await tx.delete(tenants).where(sql`${tenants.id} = ${tenantId}::uuid`);
    });

    return NextResponse.json(
      {
        ok: true,
        deletedTenantId: tenantId,
        deletedTenantSlug: String(t.slug),
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}