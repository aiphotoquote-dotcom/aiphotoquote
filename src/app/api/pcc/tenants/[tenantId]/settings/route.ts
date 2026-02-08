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

type PlanTier = "tier0" | "tier1" | "tier2";

function normalizeTier(v: unknown): PlanTier {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "free" || s === "tier0") return "tier0";
  if (s === "tier1") return "tier1";
  if (s === "tier2") return "tier2";
  return "tier0";
}

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

  // Normalize tier: DB stores only tier0/tier1/tier2
  const nextTier: PlanTier | undefined =
    patch.planTier === undefined ? undefined : normalizeTier(patch.planTier);

  // No-op protection
  if (
    nextTier === undefined &&
    patch.monthlyQuoteLimit === undefined &&
    patch.activationGraceCredits === undefined &&
    patch.activationGraceUsed === undefined
  ) {
    return NextResponse.json({ ok: true, updated: false });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;

  await db.transaction(async (tx: any) => {
    // Ensure tenant_settings exists (some tenants may not have it yet)
    await tx.execute(sql`
      INSERT INTO tenant_settings (
        tenant_id,
        industry_key,
        plan_tier,
        activation_grace_credits,
        activation_grace_used,
        updated_at
      )
      VALUES (
        ${tenantId}::uuid,
        'unknown',
        'tier0',
        0,
        0,
        now()
      )
      ON CONFLICT (tenant_id) DO NOTHING
    `);

    // Read current settings
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
    const currentTotal = Number(cur?.activationGraceCredits ?? 0);
    const currentUsed = Number(cur?.activationGraceUsed ?? 0);
    const currentTier = normalizeTier(cur?.planTier ?? "tier0");

    const desiredTotal = patch.activationGraceCredits !== undefined ? patch.activationGraceCredits : currentTotal;
    let desiredUsed = patch.activationGraceUsed !== undefined ? patch.activationGraceUsed : currentUsed;
    if (desiredUsed > desiredTotal) desiredUsed = desiredTotal;

    const desiredTier = nextTier !== undefined ? nextTier : currentTier;

    await tx.execute(sql`
      UPDATE tenant_settings
      SET
        plan_tier = ${desiredTier},
        monthly_quote_limit = ${patch.monthlyQuoteLimit === undefined ? (cur?.monthlyQuoteLimit ?? null) : patch.monthlyQuoteLimit},
        activation_grace_credits = ${desiredTotal},
        activation_grace_used = ${desiredUsed},
        plan_selected_at = CASE
          WHEN ${nextTier ?? null} IS NULL THEN plan_selected_at
          ELSE now()
        END,
        updated_at = now()
      WHERE tenant_id = ${tenantId}::uuid
    `);

    // Best-effort audit: only insert if table exists
    const auditExistsR = await tx.execute(sql`
      SELECT to_regclass('public.tenant_audit_log')::text AS name
    `);
    const auditExists = Boolean(rows(auditExistsR)?.[0]?.name);

    if (auditExists) {
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
          ${ip},
          NULL,
          ${JSON.stringify({
            tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
            previous: {
              planTier: currentTier,
              activationGraceCredits: currentTotal,
              activationGraceUsed: currentUsed,
            },
            next: {
              planTier: desiredTier,
              monthlyQuoteLimit: patch.monthlyQuoteLimit,
              activationGraceCredits: desiredTotal,
              activationGraceUsed: desiredUsed,
            },
          })}::jsonb
        )
      `);
    }
  });

  return NextResponse.json({ ok: true, updated: true });
}