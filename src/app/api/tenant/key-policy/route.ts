// src/app/api/tenant/key-policy/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { requireTenantRole } from "@/lib/auth/tenant";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  tenantId: z.string().uuid(),
});

function safeTrimLower(v: unknown) {
  const s = String(v ?? "").trim().toLowerCase();
  return s ? s : "";
}

function detectPlatformKey(): { hasPlatformKey: boolean; envName: string | null } {
  const candidates = ["OPENAI_API_KEY", "OPENAI_PLATFORM_API_KEY", "OPENAI_KEY"] as const;
  for (const name of candidates) {
    const v = String(process.env[name] ?? "").trim();
    if (v) return { hasPlatformKey: true, envName: name };
  }
  return { hasPlatformKey: false, envName: null };
}

function hasGraceRemaining(credits: unknown, used: unknown): boolean {
  const c = Number(credits ?? 0);
  const u = Number(used ?? 0);
  if (!Number.isFinite(c) || !Number.isFinite(u)) return false;
  return c > 0 && u < c;
}

function isTier0(tier: string) {
  return tier === "tier0";
}
function isTier1or2(tier: string) {
  return tier === "tier1" || tier === "tier2";
}

/**
 * We have schema drift between environments:
 * - some DBs store plan_tier on tenants.plan_tier
 * - others store plan_tier on tenant_settings.plan_tier
 *
 * This route must work in both.
 */
export async function GET(req: Request) {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error, message: gate.message }, { status: gate.status });
  }

  const url = new URL(req.url);
  const parsed = Query.safeParse({ tenantId: url.searchParams.get("tenantId") || "" });
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "BAD_REQUEST", message: "Invalid query params", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  if (parsed.data.tenantId !== gate.tenantId) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN", message: "Tenant mismatch." }, { status: 403 });
  }

  const tenantId = parsed.data.tenantId;

  /**
   * ✅ Schema-tolerant plan tier:
   * Prefer tenant_settings.plan_tier (ts.plan_tier) when present,
   * otherwise fallback to tenants.plan_tier if it exists.
   *
   * We avoid referencing t.plan_tier directly unless the column exists,
   * otherwise Postgres throws at parse-time (your current 500).
   */
  const r = await db.execute(sql`
    with col as (
      select
        exists (
          select 1
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'tenants'
            and column_name = 'plan_tier'
        ) as tenants_has_plan_tier,
        exists (
          select 1
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'tenant_settings'
            and column_name = 'plan_tier'
        ) as settings_has_plan_tier
    )
    select
      -- plan tier (schema tolerant)
      case
        when (select settings_has_plan_tier from col) then ts.plan_tier::text
        when (select tenants_has_plan_tier from col) then (
          select (t_row->>'plan_tier')::text
          from (
            select row_to_json(t) as t_row
            from tenants t
            where t.id = ${tenantId}::uuid
            limit 1
          ) x
        )
        else null
      end as plan_tier,

      ts.activation_grace_credits as activation_grace_credits,
      ts.activation_grace_used as activation_grace_used,
      sec.openai_key_enc as openai_key_enc

    from tenant_settings ts
    left join tenant_secrets sec on sec.tenant_id = ts.tenant_id
    where ts.tenant_id = ${tenantId}::uuid
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  if (!row) {
    return NextResponse.json(
      { ok: false, error: "SETTINGS_MISSING", message: "Tenant settings not found." },
      { status: 404 }
    );
  }

  const planTier = safeTrimLower(row.plan_tier) || "tier0";

  const activationGraceCredits = Number(row.activation_grace_credits ?? 0) || 0;
  const activationGraceUsed = Number(row.activation_grace_used ?? 0) || 0;

  const hasTenantOpenAiKey = Boolean(row.openai_key_enc);

  const graceRemaining = hasGraceRemaining(activationGraceCredits, activationGraceUsed);

  const platformAllowed = isTier0(planTier) || (isTier1or2(planTier) && graceRemaining);

  const { hasPlatformKey, envName: platformKeyEnvName } = detectPlatformKey();

  const effectiveKeySourceNow: "tenant" | "platform_grace" | "none" = hasTenantOpenAiKey
    ? "tenant"
    : platformAllowed && hasPlatformKey
      ? "platform_grace"
      : "none";

  const wouldConsumeGraceOnNewQuote =
    effectiveKeySourceNow === "platform_grace" && isTier1or2(planTier);

  let reason: string | null = null;
  if (effectiveKeySourceNow === "tenant") {
    reason = "Tenant key is set.";
  } else if (!hasPlatformKey) {
    reason =
      "Platform OpenAI key is not configured in this deployment environment (Preview/Prod env vars may differ).";
  } else if (!platformAllowed) {
    reason = "Platform key is configured but not allowed for this plan tier.";
  } else if (wouldConsumeGraceOnNewQuote) {
    reason = "Currently using platform key under grace. New quotes will consume a grace credit until grace runs out.";
  } else {
    reason = "Currently using platform key. This request type will not consume grace.";
  }

  return NextResponse.json({
    ok: true,
    tenantId,

    planTier,
    activationGraceCredits,
    activationGraceUsed,
    hasTenantOpenAiKey,

    hasPlatformKey,
    platformKeyEnvName,
    platformAllowed,
    graceRemaining,

    effectiveKeySourceNow,
    wouldConsumeGraceOnNewQuote,
    reason,
  });
}