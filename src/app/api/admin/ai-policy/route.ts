// src/app/api/admin/ai-policy/route.ts
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

const AiMode = z.enum(["assessment_only", "range", "fixed"]);
const RenderingStyle = z.enum(["photoreal", "clean_oem", "custom"]);

const PricingModel = z.enum([
  "flat_per_job",
  "hourly_plus_materials",
  "per_unit",
  "packages",
  "line_items",
  "inspection_only",
  "assessment_fee",
]);

const PricingConfigSchema = z
  .object({
    flat_rate_default: z.number().int().min(0).max(2_000_000).nullable().optional(),

    hourly_labor_rate: z.number().int().min(0).max(2_000_000).nullable().optional(),
    material_markup_percent: z.number().int().min(0).max(500).nullable().optional(),

    per_unit_rate: z.number().int().min(0).max(2_000_000).nullable().optional(),
    per_unit_label: z.string().max(64).nullable().optional(),

    package_json: z.any().nullable().optional(),
    line_items_json: z.any().nullable().optional(),

    assessment_fee_amount: z.number().int().min(0).max(2_000_000).nullable().optional(),
    assessment_fee_credit_toward_job: z.boolean().optional(),
  })
  .optional();

const PostBody = z.object({
  ai_mode: AiMode,
  pricing_enabled: z.boolean(),

  // saved pricing config (pricing_model remains onboarding-owned)
  pricing_config: PricingConfigSchema,

  /**
   * IMPORTANT: This is the UI’s single toggle.
   * Server will sync BOTH columns:
   * - ai_rendering_enabled (new / preferred)
   * - rendering_enabled (legacy / back-compat)
   */
  rendering_enabled: z.boolean(),
  rendering_style: RenderingStyle,
  rendering_notes: z.string().max(2000),
  rendering_max_per_day: z.number().int().min(0).max(1000),
  rendering_customer_opt_in_required: z.boolean(),

  live_qa_enabled: z.boolean().optional().default(false),
  live_qa_max_questions: z.number().int().min(1).max(10).optional().default(3),
});

function clampInt(n: any, fallback: number, min: number, max: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function clampMoneyInt(v: any, fallback: number | null, min = 0, max = 2_000_000) {
  if (v === null || v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const m = Math.round(n);
  return Math.max(min, Math.min(max, m));
}

function clampPercentInt(v: any, fallback: number | null, min = 0, max = 500) {
  if (v === null || v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const p = Math.round(n);
  return Math.max(min, Math.min(max, p));
}

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function normalizePricingModel(v: any): z.infer<typeof PricingModel> | null {
  const s = safeTrim(v);
  if (!s) return null;
  const parsed = PricingModel.safeParse(s);
  return parsed.success ? parsed.data : null;
}

function normalizeAiMode(v: any): z.infer<typeof AiMode> {
  const s = safeTrim(v);
  const parsed = AiMode.safeParse(s);
  return parsed.success ? parsed.data : "assessment_only";
}

function enforcePricingRule(ai_mode: z.infer<typeof AiMode>, pricing_enabled: boolean): z.infer<typeof AiMode> {
  return pricing_enabled ? ai_mode : "assessment_only";
}

async function getTenantSettingsRow(tenantId: string) {
  const r = await db.execute(sql`
    select
      ai_mode,
      pricing_enabled,
      pricing_model,

      flat_rate_default,
      hourly_labor_rate,
      material_markup_percent,
      per_unit_rate,
      per_unit_label,
      package_json,
      line_items_json,
      assessment_fee_amount,
      assessment_fee_credit_toward_job,

      -- ✅ read BOTH columns (new + legacy)
      ai_rendering_enabled,
      rendering_enabled,

      rendering_style,
      rendering_notes,
      rendering_max_per_day,
      rendering_customer_opt_in_required,

      live_qa_enabled,
      live_qa_max_questions
    from tenant_settings
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  return row ?? null;
}

async function getOnboardingAnalysis(tenantId: string): Promise<any | null> {
  try {
    const r = await db.execute(sql`
      select ai_analysis
      from tenant_onboarding
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);
    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
    const analysis = row?.ai_analysis ?? null;
    return analysis && typeof analysis === "object" ? analysis : null;
  } catch {
    return null;
  }
}

function normalizePricingConfig(row: any) {
  const flat_rate_default = clampMoneyInt(row?.flat_rate_default, null);
  const hourly_labor_rate = clampMoneyInt(row?.hourly_labor_rate, null);
  const material_markup_percent = clampPercentInt(row?.material_markup_percent, null);

  const per_unit_rate = clampMoneyInt(row?.per_unit_rate, null);
  const per_unit_label = safeTrim(row?.per_unit_label) || null;

  const package_json = row?.package_json ?? null;
  const line_items_json = row?.line_items_json ?? null;

  const assessment_fee_amount = clampMoneyInt(row?.assessment_fee_amount, null);
  const assessment_fee_credit_toward_job = Boolean(row?.assessment_fee_credit_toward_job ?? false);

  return {
    flat_rate_default,
    hourly_labor_rate,
    material_markup_percent,
    per_unit_rate,
    per_unit_label,
    package_json,
    line_items_json,
    assessment_fee_amount,
    assessment_fee_credit_toward_job,
  };
}

/**
 * Suggestions remain generic; do NOT hardcode industry-specific language here.
 */
function buildSuggestedPricingConfig(args: { pricingModel: z.infer<typeof PricingModel> | null; analysis: any | null }) {
  const { analysis } = args;

  const signalsArr: string[] = Array.isArray(analysis?.billingSignals) ? analysis.billingSignals.map((x: any) => String(x)) : [];
  const servicesArr: string[] = Array.isArray(analysis?.detectedServices) ? analysis.detectedServices.map((x: any) => String(x)) : [];
  const hay = `${signalsArr.join(" ")} ${servicesArr.join(" ")}`.toLowerCase();

  const mentionsHourly = /\bhour\b|\bper hour\b|\bhourly\b/.test(hay);
  const mentionsSqFt = /\bsq\s?ft\b|\bsquare\s?foot\b/.test(hay);
  const mentionsLinear = /\blinear\s?ft\b|\bper\s?foot\b/.test(hay);
  const mentionsDiagnostic = /\bdiagnostic\b|\bassessment\b|\binspection\b/.test(hay);
  const mentionsPremium = /\bpremium\b|\bluxury\b|\bhigh[-\s]?end\b/.test(hay);
  const mentionsMobile = /\bmobile\b|\bon[-\s]?site\b|\btravel\b/.test(hay);
  const mentionsPackage = /\bpackage\b|\btier\b|\bstandard\b|\bpremium\b|\bbasic\b/.test(hay);

  const laborBase = mentionsPremium ? 175 : mentionsMobile ? 140 : 125;
  const markupBase = 30;

  const unitLabel = mentionsSqFt ? "sq ft" : mentionsLinear ? "linear ft" : "unit";
  const perUnitRate = unitLabel === "sq ft" ? 12 : unitLabel === "linear ft" ? 25 : 15;

  const flatDefault = mentionsPremium ? 900 : 500;
  const assessmentFee = mentionsDiagnostic ? 99 : 75;

  const packageJson = mentionsPackage
    ? {
        tiers: [
          { name: "Basic", price: flatDefault, includes: ["Base service"] },
          { name: "Standard", price: Math.round(flatDefault * 1.6), includes: ["Base service", "Common add-ons"] },
          { name: "Premium", price: Math.round(flatDefault * 2.4), includes: ["Base service", "Upgrades", "Highest finish"] },
        ],
      }
    : null;

  const lineItemsJson = {
    items: [
      { key: "base", label: "Base service", price: flatDefault },
      { key: "pickup", label: "Pickup / delivery", price: 150 },
    ],
  };

  return {
    flat_rate_default: flatDefault,
    hourly_labor_rate: mentionsHourly ? laborBase : laborBase,
    material_markup_percent: markupBase,
    per_unit_rate: perUnitRate,
    per_unit_label: unitLabel,
    package_json: packageJson,
    line_items_json: lineItemsJson,
    assessment_fee_amount: assessmentFee,
    assessment_fee_credit_toward_job: true,
  };
}

function normalizeRow(row: any, analysis: any | null) {
  const pricing_enabled = Boolean(row?.pricing_enabled ?? false);

  const ai_mode_raw = normalizeAiMode(row?.ai_mode ?? "assessment_only");
  const ai_mode = enforcePricingRule(ai_mode_raw, pricing_enabled);

  const pricing_model = normalizePricingModel(row?.pricing_model);

  // ✅ effective render enabled = (new OR legacy)
  const rendering_enabled = Boolean(row?.ai_rendering_enabled ?? false) || Boolean(row?.rendering_enabled ?? false);

  const rendering_style_raw = safeTrim(row?.rendering_style ?? "photoreal");
  const rendering_style =
    rendering_style_raw === "photoreal" || rendering_style_raw === "clean_oem" || rendering_style_raw === "custom"
      ? rendering_style_raw
      : "photoreal";

  const rendering_notes = String(row?.rendering_notes ?? "");
  const rendering_max_per_day = clampInt(row?.rendering_max_per_day, 20, 0, 1000);
  const rendering_customer_opt_in_required = Boolean(row?.rendering_customer_opt_in_required ?? true);

  const live_qa_enabled = Boolean(row?.live_qa_enabled ?? false);
  const live_qa_max_questions = clampInt(row?.live_qa_max_questions, 3, 1, 10);

  const pricing_config = normalizePricingConfig(row);
  const pricing_suggested = buildSuggestedPricingConfig({ pricingModel: pricing_model, analysis });

  return {
    ai_mode,
    pricing_enabled,
    pricing_model,

    pricing_computation: "server_components" as const,

    pricing_config,
    pricing_suggested,

    rendering_enabled,
    rendering_style,
    rendering_notes,
    rendering_max_per_day,
    rendering_customer_opt_in_required,

    live_qa_enabled,
    live_qa_max_questions,
  };
}

export async function GET() {
  const gate = await requireTenantRole(["owner", "admin", "member"]);
  if (!gate.ok) return json({ ok: false, error: gate.error, message: gate.message }, gate.status);

  const row = await getTenantSettingsRow(gate.tenantId);
  if (!row) {
    return json({ ok: false, error: "SETTINGS_MISSING", message: "Tenant settings could not be loaded." }, 500);
  }

  const analysis = await getOnboardingAnalysis(gate.tenantId);
  const normalized = normalizeRow(row, analysis);

  return json({
    ok: true,
    tenantId: gate.tenantId,
    role: gate.role,
    ai_policy: normalized,
  });
}

export async function POST(req: Request) {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) return json({ ok: false, error: gate.error, message: gate.message }, gate.status);

  const body = await req.json().catch(() => null);
  const parsed = PostBody.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, 400);
  }

  try {
    const incoming = parsed.data;

    const pricing_enabled = Boolean(incoming.pricing_enabled);
    const ai_mode = enforcePricingRule(incoming.ai_mode, pricing_enabled);

    const pc = incoming.pricing_config ?? {};

    const flat_rate_default = clampMoneyInt((pc as any).flat_rate_default, null);
    const hourly_labor_rate = clampMoneyInt((pc as any).hourly_labor_rate, null);
    const material_markup_percent = clampPercentInt((pc as any).material_markup_percent, null);

    const per_unit_rate = clampMoneyInt((pc as any).per_unit_rate, null);
    const per_unit_label = safeTrim((pc as any).per_unit_label) || null;

    const package_json = (pc as any).package_json ?? null;
    const line_items_json = (pc as any).line_items_json ?? null;

    const assessment_fee_amount = clampMoneyInt((pc as any).assessment_fee_amount, null);
    const assessment_fee_credit_toward_job = Boolean((pc as any).assessment_fee_credit_toward_job ?? false);

    const renderingEnabled = Boolean(incoming.rendering_enabled);

    // ✅ IMPORTANT: write BOTH columns so they never drift again
    const upd = await db.execute(sql`
      update tenant_settings
      set
        ai_mode = ${ai_mode},
        pricing_enabled = ${pricing_enabled},

        flat_rate_default = ${flat_rate_default},
        hourly_labor_rate = ${hourly_labor_rate},
        material_markup_percent = ${material_markup_percent},
        per_unit_rate = ${per_unit_rate},
        per_unit_label = ${per_unit_label},
        package_json = ${JSON.stringify(package_json)}::jsonb,
        line_items_json = ${JSON.stringify(line_items_json)}::jsonb,
        assessment_fee_amount = ${assessment_fee_amount},
        assessment_fee_credit_toward_job = ${assessment_fee_credit_toward_job},

        ai_rendering_enabled = ${renderingEnabled},
        rendering_enabled = ${renderingEnabled},

        rendering_style = ${incoming.rendering_style},
        rendering_notes = ${incoming.rendering_notes ?? ""},
        rendering_max_per_day = ${clampInt(incoming.rendering_max_per_day, 20, 0, 1000)},
        rendering_customer_opt_in_required = ${incoming.rendering_customer_opt_in_required},

        live_qa_enabled = ${Boolean(incoming.live_qa_enabled)},
        live_qa_max_questions = ${clampInt(incoming.live_qa_max_questions, 3, 1, 10)},

        updated_at = now()
      where tenant_id = ${gate.tenantId}::uuid
      returning tenant_id
    `);

    const updatedRow: any = (upd as any)?.rows?.[0] ?? (Array.isArray(upd) ? (upd as any)[0] : null);
    if (!updatedRow?.tenant_id) {
      return json({ ok: false, error: "SETTINGS_MISSING", message: "Tenant settings row missing; cannot update." }, 500);
    }

    const row = await getTenantSettingsRow(gate.tenantId);
    if (!row) {
      return json({ ok: false, error: "SETTINGS_MISSING", message: "Tenant settings could not be loaded after update." }, 500);
    }

    const analysis = await getOnboardingAnalysis(gate.tenantId);
    const normalized = normalizeRow(row, analysis);

    return json({
      ok: true,
      tenantId: gate.tenantId,
      role: gate.role,
      ai_policy: normalized,
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