// src/app/api/admin/tenant-settings/route.ts
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

/* ----------------------------- zod helpers ----------------------------- */

const NullableUrl = z.preprocess((v) => {
  if (typeof v === "string" && v.trim() === "") return null;
  return v;
}, z.string().trim().url().max(500).nullable());

const NullableString = (max: number) =>
  z.preprocess((v) => {
    if (typeof v === "string") {
      const s = v.trim();
      return s === "" ? null : s;
    }
    return v;
  }, z.string().max(max).nullable());

const BrandLogoVariant = z
  .preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.enum(["auto", "light", "dark"]).nullable())
  .optional();

const PricingModel = z.enum([
  "flat_per_job",
  "hourly_plus_materials",
  "per_unit",
  "packages",
  "line_items",
  "inspection_only",
  "assessment_fee",
]);

const AiMode = z.enum(["assessment_only", "range", "fixed"]);

const NullableInt = z.preprocess((v) => {
  if (v === "" || v === undefined) return null;
  if (v === null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}, z.number().int().nullable());

const NullableBool = z.preprocess((v) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}, z.boolean().nullable().optional());

const NullableJson = z.preprocess((v) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "object") return v; // accept objects/arrays directly
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch {
      return v; // will fail zod
    }
  }
  return v;
}, z.any().nullable().optional());

/**
 * ✅ IMPORTANT CHANGE (back-compat safe):
 * This route supports PARTIAL updates so pricing pages can write pricing fields
 * without resending branding/email fields.
 *
 * - If tenant_settings row exists: update only provided fields (undefined => preserve).
 * - If tenant_settings row DOES NOT exist: require base branding/email fields to insert.
 *
 * ✅ Pricing policy rule:
 * - If pricing_enabled is explicitly set to false:
 *   - force ai_mode = "assessment_only"
 *   - force pricing_model = null
 *   (pricing config fields may remain stored, but are ignored while disabled)
 */
const PostBody = z
  .object({
    // branding/email (optional for updates, required for first-time insert)
    business_name: z.string().trim().min(1).max(120).optional(),
    lead_to_email: z.string().trim().email().max(200).optional(),
    resend_from_email: z.string().trim().min(5).max(200).optional(), // "Name <email@domain>"

    // tenant branding
    brand_logo_url: NullableUrl.optional(),
    brand_logo_variant: BrandLogoVariant, // auto|light|dark|null

    // enterprise/oauth
    email_send_mode: z.enum(["standard", "enterprise"]).optional(),
    email_identity_id: z.string().uuid().nullable().optional(),

    // ✅ pricing policy controls
    pricing_enabled: z.boolean().optional(),
    ai_mode: AiMode.optional(),

    // ✅ pricing model + model-specific defaults
    pricing_model: PricingModel.optional(),

    flat_rate_default: NullableInt.optional(),
    hourly_labor_rate: NullableInt.optional(),
    material_markup_percent: NullableInt.optional(),
    per_unit_rate: NullableInt.optional(),
    per_unit_label: NullableString(60).optional(),

    package_json: NullableJson,
    line_items_json: NullableJson,

    assessment_fee_amount: NullableInt.optional(),
    assessment_fee_credit_toward_job: NullableBool,
  })
  .refine((obj) => Object.keys(obj).length > 0, { message: "At least one field is required." });

/* ----------------------------- db helpers ------------------------------ */

async function getTenantSettingsRow(tenantId: string) {
  const r = await db.execute(sql`
    select
      tenant_id,
      business_name,
      lead_to_email,
      resend_from_email,
      brand_logo_url,
      brand_logo_variant,
      email_send_mode,
      email_identity_id,

      pricing_enabled,
      ai_mode,

      pricing_model,
      flat_rate_default,
      hourly_labor_rate,
      material_markup_percent,
      per_unit_rate,
      per_unit_label,
      package_json,
      line_items_json,
      assessment_fee_amount,
      assessment_fee_credit_toward_job
    from tenant_settings
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  return row ?? null;
}

function normalizeEmailSendMode(v: unknown): "standard" | "enterprise" {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "enterprise" ? "enterprise" : "standard";
}

function normalizeAiMode(v: unknown): "assessment_only" | "range" | "fixed" {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "fixed") return "fixed";
  if (s === "range") return "range";
  return "assessment_only";
}

/**
 * Apply partial update semantics:
 * - undefined => preserve existing value
 * - null => clear (when allowed)
 */
async function upsertTenantSettingsPartial(tenantId: string, data: z.infer<typeof PostBody>) {
  const existing = await getTenantSettingsRow(tenantId);

  // Determine effective email send mode
  const emailSendMode =
    data.email_send_mode !== undefined
      ? normalizeEmailSendMode(data.email_send_mode)
      : normalizeEmailSendMode(existing?.email_send_mode ?? "standard");

  // Pricing enabled (effective)
  const pricingEnabledEffective =
    data.pricing_enabled !== undefined ? Boolean(data.pricing_enabled) : Boolean(existing?.pricing_enabled ?? false);

  // AI mode (effective) — if pricing disabled, force assessment_only
  const aiModeEffective = pricingEnabledEffective
    ? data.ai_mode !== undefined
      ? normalizeAiMode(data.ai_mode)
      : normalizeAiMode(existing?.ai_mode ?? "assessment_only")
    : "assessment_only";

  // pricing_model expression — if pricing disabled (explicit or effective), force null
  const pricingModelExpr =
    pricingEnabledEffective === false ? null : data.pricing_model !== undefined ? data.pricing_model : sql`pricing_model`;

  // Only allow email_identity_id change if caller provided it.
  const emailIdentityIdExpr =
    data.email_identity_id !== undefined
      ? emailSendMode === "enterprise"
        ? data.email_identity_id
        : data.email_identity_id // allow explicit clear even in standard mode
      : sql`email_identity_id`;

  // logo fields
  const brandLogoUrlExpr = data.brand_logo_url !== undefined ? (data.brand_logo_url ?? null) : sql`brand_logo_url`;
  const brandLogoVariantExpr =
    data.brand_logo_variant !== undefined ? (data.brand_logo_variant ?? null) : sql`brand_logo_variant`;

  // pricing fields (config stays as-is; ignored when pricing_enabled=false)
  const flatRateDefaultExpr = data.flat_rate_default !== undefined ? data.flat_rate_default : sql`flat_rate_default`;
  const hourlyLaborRateExpr = data.hourly_labor_rate !== undefined ? data.hourly_labor_rate : sql`hourly_labor_rate`;
  const materialMarkupPercentExpr =
    data.material_markup_percent !== undefined ? data.material_markup_percent : sql`material_markup_percent`;
  const perUnitRateExpr = data.per_unit_rate !== undefined ? data.per_unit_rate : sql`per_unit_rate`;
  const perUnitLabelExpr = data.per_unit_label !== undefined ? data.per_unit_label : sql`per_unit_label`;

  const packageJsonExpr = data.package_json !== undefined ? data.package_json : sql`package_json`;
  const lineItemsJsonExpr = data.line_items_json !== undefined ? data.line_items_json : sql`line_items_json`;

  const assessmentFeeAmountExpr =
    data.assessment_fee_amount !== undefined ? data.assessment_fee_amount : sql`assessment_fee_amount`;
  const assessmentFeeCreditExpr =
    data.assessment_fee_credit_toward_job !== undefined
      ? (data.assessment_fee_credit_toward_job ?? null)
      : sql`assessment_fee_credit_toward_job`;

  // Branding/email required only if inserting a missing row
  if (!existing) {
    const businessName = (data.business_name ?? "").trim();
    const leadToEmail = (data.lead_to_email ?? "").trim();
    const resendFromEmail = (data.resend_from_email ?? "").trim();

    if (!businessName || !leadToEmail || !resendFromEmail) {
      const e: any = new Error(
        "TENANT_SETTINGS_MISSING: tenant_settings row does not exist yet; provide business_name, lead_to_email, resend_from_email to create it."
      );
      e.code = "TENANT_SETTINGS_MISSING";
      throw e;
    }

    await db.execute(sql`
      insert into tenant_settings (
        tenant_id,
        industry_key,

        business_name,
        lead_to_email,
        resend_from_email,

        brand_logo_url,
        brand_logo_variant,

        email_send_mode,
        email_identity_id,

        pricing_enabled,
        ai_mode,

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

        updated_at
      )
      values (
        ${tenantId}::uuid,
        'auto',

        ${businessName},
        ${leadToEmail},
        ${resendFromEmail},

        ${data.brand_logo_url ?? null},
        ${data.brand_logo_variant ?? "auto"},

        ${emailSendMode},
        ${emailSendMode === "enterprise" ? (data.email_identity_id ?? null) : (data.email_identity_id ?? null)},

        ${pricingEnabledEffective},
        ${aiModeEffective},

        ${pricingEnabledEffective ? (data.pricing_model ?? null) : null},
        ${data.flat_rate_default ?? null},
        ${data.hourly_labor_rate ?? null},
        ${data.material_markup_percent ?? null},
        ${data.per_unit_rate ?? null},
        ${data.per_unit_label ?? null},
        ${data.package_json ?? null}::jsonb,
        ${data.line_items_json ?? null}::jsonb,
        ${data.assessment_fee_amount ?? null},
        ${data.assessment_fee_credit_toward_job ?? null},

        now()
      )
    `);

    return await getTenantSettingsRow(tenantId);
  }

  // Update existing row with "preserve unless provided" semantics.
  // pricing_enabled: if provided => set it, else preserve.
  const pricingEnabledExpr =
    data.pricing_enabled !== undefined ? Boolean(data.pricing_enabled) : sql`pricing_enabled`;

  // ai_mode: if pricing disabled (effective) force assessment_only; else preserve unless provided.
  const aiModeExpr =
    pricingEnabledEffective === false
      ? "assessment_only"
      : data.ai_mode !== undefined
        ? aiModeEffective
        : sql`ai_mode`;

  const upd = await db.execute(sql`
    update tenant_settings
    set
      business_name = ${data.business_name !== undefined ? data.business_name : sql`business_name`},
      lead_to_email = ${data.lead_to_email !== undefined ? data.lead_to_email : sql`lead_to_email`},
      resend_from_email = ${data.resend_from_email !== undefined ? data.resend_from_email : sql`resend_from_email`},

      brand_logo_url = ${brandLogoUrlExpr},
      brand_logo_variant = ${brandLogoVariantExpr},

      email_send_mode = ${emailSendMode},
      email_identity_id = ${emailIdentityIdExpr},

      pricing_enabled = ${pricingEnabledExpr},
      ai_mode = ${aiModeExpr},

      pricing_model = ${pricingModelExpr},
      flat_rate_default = ${flatRateDefaultExpr},
      hourly_labor_rate = ${hourlyLaborRateExpr},
      material_markup_percent = ${materialMarkupPercentExpr},
      per_unit_rate = ${perUnitRateExpr},
      per_unit_label = ${perUnitLabelExpr},
      package_json = ${packageJsonExpr}::jsonb,
      line_items_json = ${lineItemsJsonExpr}::jsonb,
      assessment_fee_amount = ${assessmentFeeAmountExpr},
      assessment_fee_credit_toward_job = ${assessmentFeeCreditExpr},

      updated_at = now()
    where tenant_id = ${tenantId}::uuid
    returning tenant_id
  `);

  const updatedRow: any = (upd as any)?.rows?.[0] ?? (Array.isArray(upd) ? (upd as any)[0] : null);
  if (updatedRow?.tenant_id) return await getTenantSettingsRow(tenantId);

  const e: any = new Error("TENANT_SETTINGS_UPDATE_FAILED");
  e.code = "TENANT_SETTINGS_UPDATE_FAILED";
  throw e;
}

/* ------------------------------ handlers ------------------------------ */

export async function GET() {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status);

  const settings = await getTenantSettingsRow(gate.tenantId);

  return json({
    ok: true,
    tenantId: gate.tenantId,
    role: gate.role,
    settings: {
      // branding/email
      business_name: settings?.business_name ?? "",
      lead_to_email: settings?.lead_to_email ?? "",
      resend_from_email: settings?.resend_from_email ?? "",

      brand_logo_url: settings?.brand_logo_url ?? null,
      brand_logo_variant: settings?.brand_logo_variant ?? "auto",

      email_send_mode: settings?.email_send_mode ?? "standard",
      email_identity_id: settings?.email_identity_id ?? null,

      // pricing policy
      pricing_enabled: settings?.pricing_enabled ?? false,
      ai_mode: settings?.ai_mode ?? "assessment_only",

      // pricing config
      pricing_model: settings?.pricing_model ?? null,
      flat_rate_default: settings?.flat_rate_default ?? null,
      hourly_labor_rate: settings?.hourly_labor_rate ?? null,
      material_markup_percent: settings?.material_markup_percent ?? null,
      per_unit_rate: settings?.per_unit_rate ?? null,
      per_unit_label: settings?.per_unit_label ?? null,
      package_json: settings?.package_json ?? null,
      line_items_json: settings?.line_items_json ?? null,
      assessment_fee_amount: settings?.assessment_fee_amount ?? null,
      assessment_fee_credit_toward_job: settings?.assessment_fee_credit_toward_job ?? null,
    },
  });
}

export async function POST(req: Request) {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status);

  const body = await req.json().catch(() => null);
  const parsed = PostBody.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, 400);
  }

  try {
    const saved = await upsertTenantSettingsPartial(gate.tenantId, parsed.data);

    return json({
      ok: true,
      tenantId: gate.tenantId,
      role: gate.role,
      settings: {
        // branding/email
        business_name: saved?.business_name ?? "",
        lead_to_email: saved?.lead_to_email ?? "",
        resend_from_email: saved?.resend_from_email ?? "",

        brand_logo_url: saved?.brand_logo_url ?? null,
        brand_logo_variant: saved?.brand_logo_variant ?? "auto",

        email_send_mode: saved?.email_send_mode ?? "standard",
        email_identity_id: saved?.email_identity_id ?? null,

        // pricing policy
        pricing_enabled: saved?.pricing_enabled ?? false,
        ai_mode: saved?.ai_mode ?? "assessment_only",

        // pricing config
        pricing_model: saved?.pricing_model ?? null,
        flat_rate_default: saved?.flat_rate_default ?? null,
        hourly_labor_rate: saved?.hourly_labor_rate ?? null,
        material_markup_percent: saved?.material_markup_percent ?? null,
        per_unit_rate: saved?.per_unit_rate ?? null,
        per_unit_label: saved?.per_unit_label ?? null,
        package_json: saved?.package_json ?? null,
        line_items_json: saved?.line_items_json ?? null,
        assessment_fee_amount: saved?.assessment_fee_amount ?? null,
        assessment_fee_credit_toward_job: saved?.assessment_fee_credit_toward_job ?? null,
      },
    });
  } catch (e: any) {
    return json(
      {
        ok: false,
        error: e?.code === "TENANT_SETTINGS_MISSING" ? "TENANT_SETTINGS_MISSING" : "DB_WRITE_FAILED",
        message: e?.message ?? String(e),
        code: e?.code,
        detail: e?.detail,
        hint: e?.hint,
      },
      e?.code === "TENANT_SETTINGS_MISSING" ? 400 : 500
    );
  }
}