// src/app/api/pcc/tenants/[tenantId]/delete/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  tenantId: z.string().uuid(),
});

const ArchiveBody = z.object({
  confirm: z.string().min(1),
  expected: z.string().min(1),
  reason: z.string().max(500).optional(),
});

function rows(r: any): any[] {
  return (r as any)?.rows ?? (Array.isArray(r) ? r : []);
}

async function countWhere(table: string, column: string, tenantId: string): Promise<number> {
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
    sql`SELECT
          id::text   AS id,
          slug::text AS slug,
          name::text AS name,
          status::text AS status,
          archived_at AS archivedAt,
          archived_by::text AS archivedBy,
          archived_reason::text AS archivedReason
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
    status: row.status ? String(row.status) : "active",
    archivedAt: row.archivedAt ?? null,
    archivedBy: row.archivedBy ? String(row.archivedBy) : null,
    archivedReason: row.archivedReason ? String(row.archivedReason) : null,
  };
}

async function getActor(req: NextRequest) {
  // Keep this best-effort. Never break the route if Clerk info isn't available.
  try {
    const a = auth();
    const userId = (a as any)?.userId ? String((a as any).userId) : null;

    let email: string | null = null;
    try {
      const u = await currentUser();
      email = (u?.emailAddresses?.[0]?.emailAddress as string) ?? null;
    } catch {
      // ignore
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;

    return { userId, email, ip };
  } catch {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;

    return { userId: null, email: null, ip };
  }
}

/**
 * GET: preview what will be archived (counts)
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

  const counts = {
    tenants: 1,

    tenantMembers: await countWhere("tenant_members", "tenant_id", tenantId),
    tenantSettings: await countWhere("tenant_settings", "tenant_id", tenantId),
    tenantSecrets: await countWhere("tenant_secrets", "tenant_id", tenantId),
    tenantPricingRules: await countWhere("tenant_pricing_rules", "tenant_id", tenantId),
    tenantEmailIdentities: await countWhere("tenant_email_identities", "tenant_id", tenantId),
    tenantSubIndustries: await countWhere("tenant_sub_industries", "tenant_id", tenantId),

    // ✅ include onboarding row (exists in prod)
    tenantOnboarding: await countWhere("tenant_onboarding", "tenant_id", tenantId),

    quoteLogs: await countWhere("quote_logs", "tenant_id", tenantId),

    // ✅ include audit rows (you write to this on archive)
    tenantAuditLog: await countWhere("tenant_audit_log", "tenant_id", tenantId),
  };

  return NextResponse.json({
    ok: true,
    mode: "archive",
    tenant,
    counts,
    expectedConfirm: tenant.slug ? `ARCHIVE ${tenant.slug}` : `ARCHIVE ${tenantId}`,
  });
}

/**
 * POST: execute archive (transactional)
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
  const body = ArchiveBody.safeParse(bodyJson);
  if (!body.success) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY", issues: body.error.issues }, { status: 400 });
  }

  const confirm = String(body.data.confirm ?? "").trim();
  const expected = String(body.data.expected ?? "").trim();
  const reason = String(body.data.reason ?? "").trim();

  if (confirm !== expected) {
    return NextResponse.json({ ok: false, error: "CONFIRM_MISMATCH", message: "Confirmation text did not match." }, { status: 400 });
  }

  const tenant = await getTenantMeta(tenantId);
  if (!tenant) {
    return NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND" }, { status: 404 });
  }

  if (tenant.status === "archived") {
    return NextResponse.json({
      ok: true,
      archivedTenantId: tenantId,
      status: "archived",
      message: "Tenant is already archived.",
    });
  }

  const actor = await getActor(req);

  await db.transaction(async (tx: any) => {
    // Archive the tenant (no deletion)
    await tx.execute(sql`
      UPDATE tenants
      SET
        status = 'archived',
        archived_at = now(),
        archived_by = ${actor.userId},
        archived_reason = ${reason || null},
        updated_at = now()
      WHERE id = ${tenantId}::uuid
    `);

    // Write audit event (append-only)
    await tx.execute(sql`
      INSERT INTO tenant_audit_log (
        tenant_id,
        action,
        actor_clerk_user_id,
        actor_email,
        actor_ip,
        reason,
        meta
      ) VALUES (
        ${tenantId}::uuid,
        'tenant.archived',
        ${actor.userId},
        ${actor.email},
        ${actor.ip},
        ${reason || null},
        ${JSON.stringify({
          tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
          previousStatus: tenant.status ?? "active",
        })}::jsonb
      )
    `);
  });

  return NextResponse.json({
    ok: true,
    archivedTenantId: tenantId,
    status: "archived",
  });
}