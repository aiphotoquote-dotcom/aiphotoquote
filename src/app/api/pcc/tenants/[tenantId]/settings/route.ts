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

// DB stores ONLY: tier0 | tier1 | tier2
// "free" is UI-friendly alias for tier0 and must never be stored.
function normalizeTier(v: unknown): "tier0" | "tier1" | "tier2" {
  const s = String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (s === "free") return "tier0";
  if (s === "tier0" || s === "tier1" || s === "tier2") return s as any;
  return "tier0";
}

const BodySchema = z.object({
  planTier: z.string().optional(), // we normalize
  monthlyQuoteLimit: z.number().int().min(0).nullable().optional(),
  graceCreditsTotal: z.number().int().min(0).optional(),
  graceUsed: z.number().int().min(0).optional(),
});

function rows(r: any): any[] {
  return (r as any)?.rows ?? (Array.isArray(r) ? r : []);
}

async function getSettings(tenantId: string) {
  const r = await db.execute(sql`
    SELECT
      ts.tenant_id::text AS "tenantId",
      ts.plan_tier::text AS "planTier",
      ts.monthly_quote_limit AS "monthlyQuoteLimit",
      ts.activation_grace_credits AS "graceCreditsTotal",
      ts.activation_grace_used AS "graceUsed",
      ts.plan_selected_at AS "planSelectedAt",
      ts.updated_at AS "updatedAt"
    FROM tenant_settings ts
    WHERE ts.tenant_id = ${tenantId}::uuid
    LIMIT 1
  `);

  const row = rows(r)[0] ?? null;
  if (!row?.tenantId) return null;

  return {
    tenantId: String(row.tenantId),
    planTier: normalizeTier(row.planTier),
    monthlyQuoteLimit:
      row.monthlyQuoteLimit === null || row.monthlyQuoteLimit === undefined
        ? null
        : Number(row.monthlyQuoteLimit),
    graceCreditsTotal: Number(row.graceCreditsTotal ?? 0),
    graceUsed: Number(row.graceUsed ?? 0),
    planSelectedAt: row.planSelectedAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

/**
 * GET: return current settings
 */
export async function GET(_req: NextRequest, context: { params: Promise<{ tenantId: string }> }) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const p = await context.params;
  const parsed = ParamsSchema.safeParse(p);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_PARAMS", issues: parsed.error.issues }, { status: 400 });
  }

  const { tenantId } = parsed.data;
  const s = await getSettings(tenantId);

  if (!s) {
    return NextResponse.json({ ok: false, error: "TENANT_SETTINGS_NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, settings: s });
}

/**
 * POST: update settings
 * (client may call PATCH; we alias PATCH -> POST below)
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
  const body = BodySchema.safeParse(bodyJson);
  if (!body.success) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY", issues: body.error.issues }, { status: 400 });
  }

  // Load current so we can detect tier change w/o the $5 typing issue
  const current = await getSettings(tenantId);
  if (!current) {
    return NextResponse.json({ ok: false, error: "TENANT_SETTINGS_NOT_FOUND" }, { status: 404 });
  }

  const nextTier =
    body.data.planTier === undefined ? current.planTier : normalizeTier(body.data.planTier);

  const nextMonthlyLimit =
    body.data.monthlyQuoteLimit === undefined ? current.monthlyQuoteLimit : body.data.monthlyQuoteLimit;

  const nextGraceTotal =
    body.data.graceCreditsTotal === undefined ? current.graceCreditsTotal : body.data.graceCreditsTotal;

  const nextGraceUsed =
    body.data.graceUsed === undefined ? current.graceUsed : body.data.graceUsed;

  // sanity: used cannot exceed total (keep it strict to avoid weird UI states)
  if (nextGraceUsed > nextGraceTotal) {
    return NextResponse.json(
      { ok: false, error: "INVALID_CREDITS", message: "Grace used cannot exceed grace total." },
      { status: 400 }
    );
  }

  const tierChanged = nextTier !== current.planTier;

  // ✅ No more “could not determine data type of parameter $5”
  await db.execute(sql`
    UPDATE tenant_settings
    SET
      plan_tier = ${nextTier}::text,
      monthly_quote_limit = ${nextMonthlyLimit},
      activation_grace_credits = ${nextGraceTotal},
      activation_grace_used = ${nextGraceUsed},
      plan_selected_at = CASE
        WHEN ${tierChanged}::boolean THEN now()
        ELSE plan_selected_at
      END,
      updated_at = now()
    WHERE tenant_id = ${tenantId}::uuid
  `);

  const updated = await getSettings(tenantId);
  return NextResponse.json({ ok: true, settings: updated });
}

/**
 * PATCH: some clients use PATCH; treat it the same as POST
 */
export async function PATCH(req: NextRequest, context: { params: Promise<{ tenantId: string }> }) {
  return POST(req, context);
}