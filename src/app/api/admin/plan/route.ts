// src/app/api/admin/plan/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requireTenantRole } from "@/lib/auth/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

type PlanTier = "free" | "pro" | "business";

const PlanSchema = z.object({
  tier: z.enum(["free", "pro", "business"]),
});

function computePlanFields(tier: PlanTier) {
  // You can tune these later. Keep them env-overridable.
  const graceDefault = Number(process.env.PLAN_ACTIVATION_GRACE_CREDITS ?? "30");
  const graceCredits = Number.isFinite(graceDefault) ? Math.max(0, Math.round(graceDefault)) : 30;

  if (tier === "free") {
    return {
      plan_tier: "free",
      monthly_quote_limit: null, // Tier 0 limiting handled elsewhere later
      activation_grace_credits: 0,
      activation_grace_used: 0,
    };
  }

  if (tier === "pro") {
    return {
      plan_tier: "pro",
      monthly_quote_limit: 50,
      activation_grace_credits: graceCredits,
      activation_grace_used: 0,
    };
  }

  // business
  return {
    plan_tier: "business",
    monthly_quote_limit: null, // unlimited
    activation_grace_credits: graceCredits,
    activation_grace_used: 0,
  };
}

async function getPlanRow(tenantId: string) {
  const r = await db.execute(sql`
    select
      plan_tier,
      monthly_quote_limit,
      activation_grace_credits,
      activation_grace_used,
      plan_selected_at
    from tenant_settings
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  return row ?? null;
}

export async function GET() {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status);

  const row = await getPlanRow(gate.tenantId);

  const tierRaw = String(row?.plan_tier ?? "free").trim().toLowerCase();
  const tier: PlanTier = tierRaw === "pro" ? "pro" : tierRaw === "business" ? "business" : "free";

  return json({
    ok: true,
    tenantId: gate.tenantId,
    role: gate.role,
    plan: {
      tier,
      monthlyQuoteLimit: typeof row?.monthly_quote_limit === "number" ? row.monthly_quote_limit : null,
      activationGraceCredits: typeof row?.activation_grace_credits === "number" ? row.activation_grace_credits : 0,
      activationGraceUsed: typeof row?.activation_grace_used === "number" ? row.activation_grace_used : 0,
      planSelectedAt: row?.plan_selected_at ?? null,
    },
  });
}

export async function POST(req: Request) {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status);

  const body = await req.json().catch(() => null);
  const parsed = PlanSchema.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, 400);
  }

  const fields = computePlanFields(parsed.data.tier);

  try {
    // Update existing row (tenant_settings should exist, but update-first is safe)
    const upd = await db.execute(sql`
      update tenant_settings
      set
        plan_tier = ${fields.plan_tier},
        monthly_quote_limit = ${fields.monthly_quote_limit},
        activation_grace_credits = ${fields.activation_grace_credits},
        activation_grace_used = ${fields.activation_grace_used},
        plan_selected_at = now(),
        updated_at = now()
      where tenant_id = ${gate.tenantId}::uuid
      returning tenant_id
    `);

    const updatedRow: any = (upd as any)?.rows?.[0] ?? (Array.isArray(upd) ? (upd as any)[0] : null);

    // If tenant_settings row is missing for some reason, insert a minimal row.
    if (!updatedRow?.tenant_id) {
      await db.execute(sql`
        insert into tenant_settings (
          tenant_id,
          industry_key,
          business_name,
          lead_to_email,
          resend_from_email,
          brand_logo_url,
          email_send_mode,
          email_identity_id,
          plan_tier,
          monthly_quote_limit,
          activation_grace_credits,
          activation_grace_used,
          plan_selected_at,
          updated_at
        ) values (
          ${gate.tenantId}::uuid,
          'auto',
          '',
          '',
          '',
          null,
          'standard',
          null,
          ${fields.plan_tier},
          ${fields.monthly_quote_limit},
          ${fields.activation_grace_credits},
          ${fields.activation_grace_used},
          now(),
          now()
        )
      `);
    }

    const row = await getPlanRow(gate.tenantId);

    const tierRaw = String(row?.plan_tier ?? "free").trim().toLowerCase();
    const tier: PlanTier = tierRaw === "pro" ? "pro" : tierRaw === "business" ? "business" : "free";

    return json({
      ok: true,
      tenantId: gate.tenantId,
      role: gate.role,
      plan: {
        tier,
        monthlyQuoteLimit: typeof row?.monthly_quote_limit === "number" ? row.monthly_quote_limit : null,
        activationGraceCredits: typeof row?.activation_grace_credits === "number" ? row.activation_grace_credits : 0,
        activationGraceUsed: typeof row?.activation_grace_used === "number" ? row.activation_grace_used : 0,
        planSelectedAt: row?.plan_selected_at ?? null,
      },
    });
  } catch (e: any) {
    return json(
      {
        ok: false,
        error: "DB_WRITE_FAILED",
        message: e?.message ?? String(e),
        code: e?.code,
        detail: e?.detail,
        hint: e?.hint,
      },
      500
    );
  }
}