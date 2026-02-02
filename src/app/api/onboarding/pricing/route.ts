// src/app/api/onboarding/pricing/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";

import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function toIntOrNull(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function clampInt(v: unknown, min: number, max: number): number | null {
  const n = toIntOrNull(v);
  if (n == null) return null;
  return Math.max(min, Math.min(max, n));
}

/**
 * Ensures we have an app_users row for the currently signed-in Clerk user.
 * Returns app_users.id (uuid as string).
 */
async function ensureAppUser(): Promise<string> {
  const session = await auth();
  const userId = (session as any)?.userId as string | null;
  if (!userId) throw new Error("UNAUTHENTICATED");

  const u = await currentUser();
  const email = u?.emailAddresses?.[0]?.emailAddress ?? null;
  const name = u?.fullName ?? u?.firstName ?? null;

  // UPSERT by unique constraint (provider+subject)
  const r = await db.execute(sql`
    insert into app_users (id, auth_provider, auth_subject, email, name, created_at, updated_at)
    values (gen_random_uuid(), 'clerk', ${userId}, ${email}, ${name}, now(), now())
    on conflict on constraint app_users_provider_subject_uq
    do update set
      email = coalesce(excluded.email, app_users.email),
      name = coalesce(excluded.name, app_users.name),
      updated_at = now()
    returning id
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  const id = row?.id ? String(row.id) : "";
  if (!id) throw new Error("FAILED_TO_UPSERT_APP_USER");
  return id;
}

async function findTenantForUser(appUserId: string): Promise<string | null> {
  const r = await db.execute(sql`
    select tm.tenant_id
    from tenant_members tm
    where tm.user_id = ${appUserId}::uuid
    order by tm.created_at asc
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  return row?.tenant_id ? String(row.tenant_id) : null;
}

export async function GET() {
  try {
    const appUserId = await ensureAppUser();
    const tenantId = await findTenantForUser(appUserId);
    if (!tenantId) return NextResponse.json({ ok: false, error: "NO_TENANT" }, { status: 400 });

    const r = await db.execute(sql`
      select
        ts.pricing_enabled,
        pr.min_job,
        pr.typical_low,
        pr.typical_high,
        pr.max_without_inspection,
        pr.tone,
        pr.risk_posture,
        pr.always_estimate_language,
        o.ai_analysis
      from tenant_settings ts
      left join tenant_pricing_rules pr on pr.tenant_id = ts.tenant_id
      left join tenant_onboarding o on o.tenant_id = ts.tenant_id
      where ts.tenant_id = ${tenantId}::uuid
      limit 1
    `);

    const row: any = (r as any)?.rows?.[0] ?? null;
    const analysis = row?.ai_analysis ?? null;

    return NextResponse.json(
      {
        ok: true,
        tenantId,
        pricingEnabled: row?.pricing_enabled ?? null,
        pricingRules: {
          minJob: row?.min_job ?? null,
          typicalLow: row?.typical_low ?? null,
          typicalHigh: row?.typical_high ?? null,
          maxWithoutInspection: row?.max_without_inspection ?? null,
          tone: row?.tone ?? null,
          riskPosture: row?.risk_posture ?? null,
          alwaysEstimateLanguage: row?.always_estimate_language ?? null,
        },
        // v1: we stash “billing model / labor / materials” selections in onboarding.ai_analysis.pricingSetup
        // until we add explicit DB fields.
        pricingSetup: analysis?.pricingSetup ?? null,
      },
      { status: 200 }
    );
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}

/**
 * POST saves Step 4 (Pricing model setup)
 *
 * We persist what the DB supports today:
 * - tenant_settings.pricing_enabled
 * - tenant_pricing_rules (min/typical/max, tone, risk, alwaysEstimateLanguage)
 *
 * We ALSO store “billing model / labor rate / materials markup” in tenant_onboarding.ai_analysis.pricingSetup
 * as an auditable interim record until we add explicit columns/tables.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    const appUserId = await ensureAppUser();
    const tenantId = await findTenantForUser(appUserId);
    if (!tenantId) return NextResponse.json({ ok: false, error: "NO_TENANT" }, { status: 400 });

    // ---- validate / normalize inputs ----
    const pricingEnabled = Boolean(body?.pricingEnabled ?? true);

    const billingModelRaw = safeTrim(body?.billingModel);
    const billingModel =
      billingModelRaw === "hourly" || billingModelRaw === "flat" || billingModelRaw === "estimate_only"
        ? billingModelRaw
        : "estimate_only";

    const laborRate = clampInt(body?.laborRate, 0, 1_000_000); // dollars/hr (v1)
    const minimumCharge = clampInt(body?.minimumCharge, 0, 10_000_000); // dollars (v1)
    const materialsMarkupPct = clampInt(body?.materialsMarkupPct, 0, 500); // percent (v1)

    const minJob = clampInt(body?.minJob, 0, 10_000_000);
    const typicalLow = clampInt(body?.typicalLow, 0, 10_000_000);
    const typicalHigh = clampInt(body?.typicalHigh, 0, 10_000_000);
    const maxWithoutInspection = clampInt(body?.maxWithoutInspection, 0, 10_000_000);

    const tone = safeTrim(body?.tone) || "value";
    const riskPosture = safeTrim(body?.riskPosture) || "conservative";
    const alwaysEstimateLanguage = body?.alwaysEstimateLanguage == null ? true : Boolean(body.alwaysEstimateLanguage);

    // ---- persist pricingEnabled ----
    await db.execute(sql`
      update tenant_settings
      set pricing_enabled = ${pricingEnabled}, updated_at = now()
      where tenant_id = ${tenantId}::uuid
    `);

    // ---- upsert tenant_pricing_rules (guardrails) ----
    // NOTE: schema has id PK; no unique constraint shown for tenant_id.
    // We'll do: if exists -> update first row; else insert.
    const existing = await db.execute(sql`
      select id
      from tenant_pricing_rules
      where tenant_id = ${tenantId}::uuid
      order by created_at asc
      limit 1
    `);

    const exRow: any = (existing as any)?.rows?.[0] ?? null;
    const pricingRuleId = exRow?.id ? String(exRow.id) : null;

    if (pricingRuleId) {
      await db.execute(sql`
        update tenant_pricing_rules
        set
          min_job = ${minJob},
          typical_low = ${typicalLow},
          typical_high = ${typicalHigh},
          max_without_inspection = ${maxWithoutInspection},
          tone = ${tone},
          risk_posture = ${riskPosture},
          always_estimate_language = ${alwaysEstimateLanguage}
        where id = ${pricingRuleId}::uuid
      `);
    } else {
      await db.execute(sql`
        insert into tenant_pricing_rules
          (id, tenant_id, min_job, typical_low, typical_high, max_without_inspection, tone, risk_posture, always_estimate_language, created_at)
        values
          (gen_random_uuid(), ${tenantId}::uuid, ${minJob}, ${typicalLow}, ${typicalHigh}, ${maxWithoutInspection}, ${tone}, ${riskPosture}, ${alwaysEstimateLanguage}, now())
      `);
    }

    // ---- stash onboarding pricingSetup (interim audit record) ----
    const pricingSetup = {
      billingModel,
      laborRate,
      minimumCharge,
      materialsMarkupPct,
      updatedAt: new Date().toISOString(),
      source: "onboarding_step_4_v1",
    };

    await db.execute(sql`
      insert into tenant_onboarding (tenant_id, ai_analysis, current_step, completed, created_at, updated_at)
      values (
        ${tenantId}::uuid,
        ${JSON.stringify({ pricingSetup })}::jsonb,
        4,
        false,
        now(),
        now()
      )
      on conflict (tenant_id) do update
      set
        ai_analysis = coalesce(tenant_onboarding.ai_analysis, '{}'::jsonb) || ${JSON.stringify({ pricingSetup })}::jsonb,
        current_step = greatest(tenant_onboarding.current_step, 4),
        updated_at = now()
    `);

    return NextResponse.json(
      {
        ok: true,
        tenantId,
        pricingEnabled,
        pricingRules: { minJob, typicalLow, typicalHigh, maxWithoutInspection, tone, riskPosture, alwaysEstimateLanguage },
        pricingSetup,
      },
      { status: 200 }
    );
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}