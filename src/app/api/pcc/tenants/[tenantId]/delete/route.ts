// src/app/api/pcc/tenants/[tenantId]/delete/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  tenantId: z.string().uuid(),
});

const DeleteBody = z.object({
  // UI should send the exact text the user typed (ex: tenant slug or "DELETE <slug>")
  confirm: z.string().min(1),
  // UI should send the expected text so server can verify (prevents guessing)
  expected: z.string().min(1),
});

function rows(r: any): any[] {
  return (r as any)?.rows ?? (Array.isArray(r) ? r : []);
}

async function countWhere(table: string, column: string, tenantId: string): Promise<number> {
  // table/column are controlled constants below (NOT user input)
  const r = await db
    .execute(
      sql`SELECT count(*)::int AS c
          FROM ${sql.raw(table)}
          WHERE ${sql.raw(column)} = ${tenantId}::uuid`
    )
    .catch(() => null);

  const rr = r ? rows(r) : [];
  const c = rr?.[0]?.c;
  return typeof c === "number" ? c : Number(c ?? 0);
}

async function getTenantMeta(tenantId: string) {
  const r = await db.execute(
    sql`SELECT id::text AS id, slug::text AS slug, name::text AS name
        FROM tenants
        WHERE id = ${tenantId}::uuid
        LIMIT 1`
  );

  const row = rows(r)?.[0] ?? null;
  if (!row?.id) return null;

  return {
    id: String(row.id),
    slug: row.slug ? String(row.slug) : null,
    name: row.name ? String(row.name) : null,
  };
}

/**
 * GET: preview what will be deleted (counts)
 * Next.js 16 expects `context.params` to be a Promise.
 */
export async function GET(_req: NextRequest, context: { params: Promise<{ tenantId: string }> }) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const p = await context.params;
  const parsed = ParamsSchema.safeParse(p);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_PARAMS", issues: parsed.error.issues }, { status: 400 });
  }

  const { tenantId } = parsed.data;

  const tenant = await getTenantMeta(tenantId);
  if (!tenant) {
    return NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND" }, { status: 404 });
  }

  // Known tenant-scoped tables (some FK are NOT cascaded, so we delete manually)
  const counts = {
    tenantMembers: await countWhere("tenant_members", "tenant_id", tenantId),
    tenantSettings: await countWhere("tenant_settings", "tenant_id", tenantId),
    tenantSecrets: await countWhere("tenant_secrets", "tenant_id", tenantId),
    tenantPricingRules: await countWhere("tenant_pricing_rules", "tenant_id", tenantId),
    tenantEmailIdentities: await countWhere("tenant_email_identities", "tenant_id", tenantId),
    tenantSubIndustries: await countWhere("tenant_sub_industries", "tenant_id", tenantId),
    quoteLogs: await countWhere("quote_logs", "tenant_id", tenantId),
  };

  return NextResponse.json({
    ok: true,
    tenant,
    counts,
    // Suggest a safe default confirm text for the UI:
    expectedConfirm: tenant.slug ? `DELETE ${tenant.slug}` : `DELETE ${tenantId}`,
  });
}

/**
 * POST: execute deletion (transactional)
 */
export async function POST(req: NextRequest, context: { params: Promise<{ tenantId: string }> }) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const p = await context.params;
  const parsed = ParamsSchema.safeParse(p);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_PARAMS", issues: parsed.error.issues }, { status: 400 });
  }
  const { tenantId } = parsed.data;

  const bodyJson = await req.json().catch(() => null);
  const body = DeleteBody.safeParse(bodyJson);
  if (!body.success) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY", issues: body.error.issues }, { status: 400 });
  }

  const confirm = String(body.data.confirm ?? "").trim();
  const expected = String(body.data.expected ?? "").trim();

  if (confirm !== expected) {
    return NextResponse.json(
      { ok: false, error: "CONFIRM_MISMATCH", message: "Confirmation text did not match." },
      { status: 400 }
    );
  }

  const tenant = await getTenantMeta(tenantId);
  if (!tenant) {
    return NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND" }, { status: 404 });
  }

  // Transactional delete in child->parent order
  await db.transaction(async (tx: any) => {
    await tx.execute(sql`DELETE FROM quote_logs WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM tenant_pricing_rules WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM tenant_secrets WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM tenant_settings WHERE tenant_id = ${tenantId}::uuid`);

    // These should cascade in many schemas, but delete anyway (safe)
    await tx.execute(sql`DELETE FROM tenant_email_identities WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM tenant_sub_industries WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM tenant_members WHERE tenant_id = ${tenantId}::uuid`);

    await tx.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`);
  });

  return NextResponse.json({ ok: true, deletedTenantId: tenantId });
}