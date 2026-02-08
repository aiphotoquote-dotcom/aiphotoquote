// src/app/api/pcc/tenants/[tenantId]/settings/route.ts
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

const PatchBody = z.object({
  planTier: z.string().min(1).max(50).optional(),
  monthlyQuoteLimit: z.number().int().min(0).nullable().optional(),
  activationGraceCredits: z.number().int().min(0).optional(),
  activationGraceUsed: z.number().int().min(0).optional(),
});

function rows(r: any): any[] {
  return (r as any)?.rows ?? (Array.isArray(r) ? r : []);
}

async function getTenantMeta(tenantId: string) {
  const r = await db.execute(sql`
    SELECT id::text AS id, slug::text AS slug, name::text AS name, status::text AS status
    FROM tenants
    WHERE id = ${tenantId}::uuid
    LIMIT 1
  `);
  const row = rows(r)?.[0] ?? null;
  if (!row?.id) return null;
  return {
    id: String(row.id),
    slug: row.slug ? String(row.slug) : null,
    name: row.name ? String(row.name) : null,
    status: row.status ? String(row.status) : "active",
  };
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ tenantId: string }> }) {
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

  const bodyJson = await req.json().catch(() => null);
  const body = PatchBody.safeParse(bodyJson);
  if (!body.success) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY", issues: body.error.issues }, { status: 400 });
  }

  const patch = body.data;

  // No-op protection
  if (
    patch.planTier === undefined &&
    patch.monthlyQuoteLimit === undefined &&
    patch.activationGraceCredits === undefined &&
    patch.activationGraceUsed === undefined
  ) {
    return NextResponse.json({ ok: true, updated: false });
  }

  // Clamp sanity: used cannot exceed total (keep DB consistent)
  const desiredTotal = patch.activationGraceCredits;
  const desiredUsed = patch.activationGraceUsed;

  await db.transaction(async (tx: any) => {
    // Read current settings (row must exist to update)
    const curR = await tx.execute(sql`
      SELECT
        plan_tier as "planTier",
        monthly_quote_limit as "monthlyQuoteLimit",
        activation_grace_credits as "activationGraceCredits",
        activation_grace_used as "activationGraceUsed"
      FROM tenant_settings
      WHERE tenant_id = ${tenantId}::uuid
      LIMIT 1
    `);

    const cur = rows(curR)?.[0] ?? null;
    if (!cur) {
      throw new Error("TENANT_SETTINGS_MISSING");
    }

    const currentTotal = Number(cur.activationGraceCredits ?? 0);
    const currentUsed = Number(cur.activationGraceUsed ?? 0);

    const nextTotal = desiredTotal !== undefined ? desiredTotal : currentTotal;
    let nextUsed = desiredUsed !== undefined ? desiredUsed : currentUsed;
    if (nextUsed > nextTotal) nextUsed = nextTotal;

    await tx.execute(sql`
      UPDATE tenant_settings
      SET
        plan_tier = COALESCE(${patch.planTier ?? null}, plan_tier),
        monthly_quote_limit = COALESCE(${patch.monthlyQuoteLimit ?? null}, monthly_quote_limit),
        activation_grace_credits = ${nextTotal},
        activation_grace_used = ${nextUsed},
        plan_selected_at = CASE
          WHEN ${patch.planTier ?? null} IS NULL THEN plan_selected_at
          ELSE now()
        END,
        updated_at = now()
      WHERE tenant_id = ${tenantId}::uuid
    `);

    // Audit (best-effort; if table isn't present it will throw — so keep it required for now)
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
        'tenant.settings.updated',
        NULL,
        NULL,
        ${req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null},
        NULL,
        ${JSON.stringify({
          tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
          changes: {
            planTier: patch.planTier,
            monthlyQuoteLimit: patch.monthlyQuoteLimit,
            activationGraceCredits: patch.activationGraceCredits,
            activationGraceUsed: patch.activationGraceUsed,
          },
        })}::jsonb
      )
    `);
  });

  return NextResponse.json({ ok: true, updated: true });
}