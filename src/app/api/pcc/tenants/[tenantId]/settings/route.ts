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

// Only store tier0/tier1/tier2 in DB.
// Accept "free" as input for back-compat and normalize to tier0.
const TierSchema = z.enum(["tier0", "tier1", "tier2", "free"]).transform((v) => (v === "free" ? "tier0" : v));

const BodySchema = z.object({
  planTier: TierSchema,
  monthlyQuoteLimit: z
    .union([z.number().int().min(0), z.string().trim().min(1)])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) return undefined;
      return n;
    }),
  graceCreditsTotal: z
    .union([z.number().int().min(0), z.string().trim().min(1)])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) return undefined;
      return n;
    }),
  graceUsed: z
    .union([z.number().int().min(0), z.string().trim().min(1)])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) return undefined;
      return n;
    }),
});

function rows(r: any): any[] {
  return (r as any)?.rows ?? (Array.isArray(r) ? r : []);
}

function normalizeDbTier(v: unknown): "tier0" | "tier1" | "tier2" {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "tier1") return "tier1";
  if (s === "tier2") return "tier2";
  // treat "free" or null/anything else as tier0
  return "tier0";
}

async function auditBestEffort(args: {
  tenantId: string;
  action: string;
  meta: any;
}) {
  // Never fail the request because audit table doesn't exist or insert fails.
  try {
    await db.execute(sql`
      INSERT INTO tenant_audit_log (
        tenant_id,
        action,
        meta
      ) VALUES (
        ${args.tenantId}::uuid,
        ${args.action},
        ${JSON.stringify(args.meta)}::jsonb
      )
    `);
  } catch {
    // ignore
  }
}

/**
 * GET: current plan + credit settings (PCC admin)
 */
export async function GET(_req: NextRequest, context: { params: Promise<{ tenantId: string }> }) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const p = await context.params;
  const parsed = ParamsSchema.safeParse(p);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_PARAMS", issues: parsed.error.issues }, { status: 400 });
  }

  const { tenantId } = parsed.data;

  const r = await db.execute(sql`
    SELECT
      ts.tenant_id::text AS tenant_id,
      ts.plan_tier::text AS plan_tier,
      ts.monthly_quote_limit::int AS monthly_quote_limit,
      ts.activation_grace_credits::int AS activation_grace_credits,
      ts.activation_grace_used::int AS activation_grace_used,
      ts.plan_selected_at AS plan_selected_at,
      ts.updated_at AS updated_at
    FROM tenant_settings ts
    WHERE ts.tenant_id = ${tenantId}::uuid
    LIMIT 1
  `);

  const row = rows(r)?.[0];
  if (!row) {
    return NextResponse.json(
      { ok: false, error: "TENANT_SETTINGS_NOT_FOUND", message: "tenant_settings row not found for tenant." },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    tenantId,
    planTier: normalizeDbTier(row.plan_tier),
    monthlyQuoteLimit: row.monthly_quote_limit ?? null,
    graceCreditsTotal: row.activation_grace_credits ?? 0,
    graceUsed: row.activation_grace_used ?? 0,
    planSelectedAt: row.plan_selected_at ?? null,
    updatedAt: row.updated_at ?? null,
  });
}

/**
 * POST: update plan + credits (PCC admin)
 */
export async function POST(req: NextRequest, context: { params: Promise<{ tenantId: string }> }) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const p = await context.params;
  const parsed = ParamsSchema.safeParse(p);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_PARAMS", issues: parsed.error.issues }, { status: 400 });
  }
  const { tenantId } = parsed.data;

  const json = await req.json().catch(() => null);
  const bodyParsed = BodySchema.safeParse(json);
  if (!bodyParsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY", issues: bodyParsed.error.issues }, { status: 400 });
  }

  const planTier = bodyParsed.data.planTier; // already normalized to tier0|tier1|tier2 by transform
  const monthlyQuoteLimit =
    bodyParsed.data.monthlyQuoteLimit === undefined ? null : bodyParsed.data.monthlyQuoteLimit;
  const graceCreditsTotal =
    bodyParsed.data.graceCreditsTotal === undefined ? 0 : bodyParsed.data.graceCreditsTotal;
  const graceUsed = bodyParsed.data.graceUsed === undefined ? 0 : bodyParsed.data.graceUsed;

  if (graceUsed > graceCreditsTotal) {
    return NextResponse.json(
      { ok: false, error: "INVALID_GRACE", message: "Grace used cannot exceed grace total." },
      { status: 400 }
    );
  }

  // Load previous values for auditing + correct “plan changed?” behavior
  const beforeR = await db.execute(sql`
    SELECT
      plan_tier::text AS plan_tier,
      monthly_quote_limit::int AS monthly_quote_limit,
      activation_grace_credits::int AS activation_grace_credits,
      activation_grace_used::int AS activation_grace_used
    FROM tenant_settings
    WHERE tenant_id = ${tenantId}::uuid
    LIMIT 1
  `);

  const before = rows(beforeR)?.[0];
  if (!before) {
    return NextResponse.json(
      { ok: false, error: "TENANT_SETTINGS_NOT_FOUND", message: "tenant_settings row not found for tenant." },
      { status: 404 }
    );
  }

  // ✅ Fix: remove untyped $5 param entirely.
  // Use IS DISTINCT FROM so NULL-safe comparisons work.
  const updatedR = await db.execute(sql`
    UPDATE tenant_settings
    SET
      plan_tier = ${planTier}::text,
      monthly_quote_limit = ${monthlyQuoteLimit}::int,
      activation_grace_credits = ${graceCreditsTotal}::int,
      activation_grace_used = ${graceUsed}::int,
      plan_selected_at = CASE
        WHEN plan_tier IS DISTINCT FROM ${planTier}::text THEN now()
        ELSE plan_selected_at
      END,
      updated_at = now()
    WHERE tenant_id = ${tenantId}::uuid
    RETURNING
      tenant_id::text AS tenant_id,
      plan_tier::text AS plan_tier,
      monthly_quote_limit::int AS monthly_quote_limit,
      activation_grace_credits::int AS activation_grace_credits,
      activation_grace_used::int AS activation_grace_used,
      plan_selected_at AS plan_selected_at,
      updated_at AS updated_at
  `);

  const out = rows(updatedR)?.[0];
  if (!out) {
    return NextResponse.json({ ok: false, error: "UPDATE_FAILED" }, { status: 500 });
  }

  // Best-effort audit (won’t break if table doesn’t exist)
  await auditBestEffort({
    tenantId,
    action: "tenant.plan.updated",
    meta: {
      before: {
        planTier: normalizeDbTier(before.plan_tier),
        monthlyQuoteLimit: before.monthly_quote_limit ?? null,
        graceCreditsTotal: before.activation_grace_credits ?? 0,
        graceUsed: before.activation_grace_used ?? 0,
      },
      after: {
        planTier: normalizeDbTier(out.plan_tier),
        monthlyQuoteLimit: out.monthly_quote_limit ?? null,
        graceCreditsTotal: out.activation_grace_credits ?? 0,
        graceUsed: out.activation_grace_used ?? 0,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    tenantId,
    planTier: normalizeDbTier(out.plan_tier),
    monthlyQuoteLimit: out.monthly_quote_limit ?? null,
    graceCreditsTotal: out.activation_grace_credits ?? 0,
    graceUsed: out.activation_grace_used ?? 0,
    planSelectedAt: out.plan_selected_at ?? null,
    updatedAt: out.updated_at ?? null,
  });
}