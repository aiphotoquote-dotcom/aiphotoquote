// src/app/api/tenant/save-settings/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants, tenantSettings } from "@/lib/db/schema";
import { requireTenantRole } from "@/lib/auth/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Save tenant settings (industry, URLs, rendering settings, reporting prefs, email prefs, etc.)
 *
 * Goals:
 * - Allow PARTIAL updates (setup wizard pages shouldn't need to send every field).
 * - Require industryKey ONLY when creating tenant_settings for the first time.
 * - Preserve existing values when fields are omitted.
 *
 * IMPORTANT:
 * - Tenant resolution is ONLY via requireTenantRole (RBAC + active tenant cookie).
 * - No cookie hunting. No fallback to "first tenant owned".
 * - This avoids tenant drift and keeps future multi-user tenants correct.
 *
 * NEW:
 * - On FIRST insert only, seed defaults for:
 *   - tier0 trial credits (activation_grace_credits=5, used=0)
 *   - platform email defaults (standard mode + from aiphotoquote.com)
 */

const Body = z.object({
  tenantSlug: z.string().min(3),

  // allow both keys from different clients
  industryKey: z.string().min(1).optional(),
  industry_key: z.string().min(1).optional(),

  redirectUrl: z.string().optional().nullable(),
  redirect_url: z.string().optional().nullable(),

  thankYouUrl: z.string().optional().nullable(),
  thank_you_url: z.string().optional().nullable(),

  businessName: z.string().optional().nullable(),
  business_name: z.string().optional().nullable(),

  leadToEmail: z.string().optional().nullable(),
  lead_to_email: z.string().optional().nullable(),

  resendFromEmail: z.string().optional().nullable(),
  resend_from_email: z.string().optional().nullable(),

  // ✅ email send mode / identity
  emailSendMode: z.string().optional().nullable(),
  email_send_mode: z.string().optional().nullable(),

  emailIdentityId: z.string().uuid().optional().nullable(),
  email_identity_id: z.string().uuid().optional().nullable(),

  aiMode: z.string().optional().nullable(),
  ai_mode: z.string().optional().nullable(),

  pricingEnabled: z.boolean().optional().nullable(),
  pricing_enabled: z.boolean().optional().nullable(),

  renderingEnabled: z.boolean().optional().nullable(),
  rendering_enabled: z.boolean().optional().nullable(),

  renderingStyle: z.string().optional().nullable(),
  rendering_style: z.string().optional().nullable(),

  renderingNotes: z.string().optional().nullable(),
  rendering_notes: z.string().optional().nullable(),

  renderingMaxPerDay: z.number().int().nonnegative().optional().nullable(),
  rendering_max_per_day: z.number().int().nonnegative().optional().nullable(),

  renderingCustomerOptInRequired: z.boolean().optional().nullable(),
  rendering_customer_opt_in_required: z.boolean().optional().nullable(),

  aiRenderingEnabled: z.boolean().optional().nullable(),
  ai_rendering_enabled: z.boolean().optional().nullable(),

  // reporting prefs
  reportingTimezone: z.string().optional().nullable(),
  reporting_timezone: z.string().optional().nullable(),

  // 1..7 (Monday..Sunday)
  weekStartsOn: z.number().int().min(1).max(7).optional().nullable(),
  week_starts_on: z.number().int().min(1).max(7).optional().nullable(),
});

function json(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      pragma: "no-cache",
      expires: "0",
    },
  });
}

function normalizeUrl(u: string | null | undefined) {
  const s = String(u ?? "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return `https://${s}`;
  return s;
}

function pick<T>(obj: any, camel: string, snake: string): T | undefined {
  const a = obj?.[camel];
  if (a !== undefined) return a as T;
  const b = obj?.[snake];
  if (b !== undefined) return b as T;
  return undefined;
}

function normalizeEmail(v: string | null | undefined) {
  const s = String(v ?? "").trim().toLowerCase();
  return s ? s : null;
}

function looksLikeEmail(v: string | null) {
  if (!v) return true; // allow null/empty
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function isAdminRole(role: string) {
  return role === "owner" || role === "admin";
}

// ✅ platform defaults (first insert only)
const DEFAULT_TRIAL_TIER = "tier0";
const DEFAULT_TRIAL_CREDITS = 5;
const DEFAULT_EMAIL_SEND_MODE = "standard";
const DEFAULT_FROM_EMAIL = "no-reply@aiphotoquote.com";

export async function POST(req: Request) {
  const gate = await requireTenantRole(["owner", "admin", "member"]);
  if (!gate.ok) return json({ ok: false, error: gate.error, message: gate.message }, gate.status);

  if (!isAdminRole(gate.role)) {
    return json({ ok: false, error: "FORBIDDEN", message: "Only owner/admin can update tenant settings." }, 403);
  }

  try {
    const body = await req.json().catch(() => null);
    const parsed = Body.safeParse(body);

    if (!parsed.success) {
      return json({ ok: false, error: "INVALID_BODY", issues: parsed.error.issues }, 400);
    }

    const data: any = parsed.data;
    const desiredSlug = String(data.tenantSlug || "").trim();

    // Load tenant by ACTIVE tenant id
    const tenant = await db
      .select({ id: tenants.id, slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, gate.tenantId as any))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!tenant) return json({ ok: false, error: "TENANT_NOT_FOUND" }, 404);

    if (desiredSlug && desiredSlug !== tenant.slug) {
      await db.update(tenants).set({ slug: desiredSlug }).where(eq(tenants.id, tenant.id));
    }

    // Load existing settings (merge partial updates safely)
    const existing = await db
      .select({
        tenantId: tenantSettings.tenantId,
        industryKey: tenantSettings.industryKey,
        redirectUrl: tenantSettings.redirectUrl,
        thankYouUrl: tenantSettings.thankYouUrl,

        businessName: tenantSettings.businessName,
        leadToEmail: tenantSettings.leadToEmail,
        resendFromEmail: tenantSettings.resendFromEmail,

        emailSendMode: tenantSettings.emailSendMode,
        emailIdentityId: tenantSettings.emailIdentityId,

        aiMode: tenantSettings.aiMode,
        pricingEnabled: tenantSettings.pricingEnabled,

        renderingEnabled: tenantSettings.renderingEnabled,
        renderingStyle: tenantSettings.renderingStyle,
        renderingNotes: tenantSettings.renderingNotes,
        renderingMaxPerDay: tenantSettings.renderingMaxPerDay,
        renderingCustomerOptInRequired: tenantSettings.renderingCustomerOptInRequired,
        aiRenderingEnabled: tenantSettings.aiRenderingEnabled,

        reportingTimezone: tenantSettings.reportingTimezone,
        weekStartsOn: tenantSettings.weekStartsOn,

        // plan fields
        planTier: tenantSettings.planTier,
        monthlyQuoteLimit: tenantSettings.monthlyQuoteLimit,
        activationGraceCredits: tenantSettings.activationGraceCredits,
        activationGraceUsed: tenantSettings.activationGraceUsed,
        planSelectedAt: tenantSettings.planSelectedAt,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenant.id))
      .limit(1)
      .then((r) => r[0] ?? null);

    const isFirstInsert = !existing;

    // Industry key: required ONLY on first insert
    const incomingIndustryKey = pick<string>(data, "industryKey", "industry_key")?.trim();
    const industryKey = incomingIndustryKey ?? existing?.industryKey ?? "";
    if (!industryKey) {
      return json(
        { ok: false, error: "MISSING_INDUSTRY_KEY", message: "industryKey is required the first time settings are saved." },
        400
      );
    }

    const redirectUrlRaw = pick<string | null>(data, "redirectUrl", "redirect_url");
    const thankYouUrlRaw = pick<string | null>(data, "thankYouUrl", "thank_you_url");

    const redirectUrl = redirectUrlRaw !== undefined ? normalizeUrl(redirectUrlRaw) : existing?.redirectUrl ?? null;
    const thankYouUrl = thankYouUrlRaw !== undefined ? normalizeUrl(thankYouUrlRaw) : existing?.thankYouUrl ?? null;

    const businessNameRaw = pick<string | null>(data, "businessName", "business_name");
    const businessName =
      businessNameRaw !== undefined ? (String(businessNameRaw ?? "").trim() || null) : existing?.businessName ?? null;

    const leadToEmailRaw = pick<string | null>(data, "leadToEmail", "lead_to_email");
    const leadToEmail = leadToEmailRaw !== undefined ? normalizeEmail(leadToEmailRaw) : existing?.leadToEmail ?? null;

    const resendFromEmailRaw = pick<string | null>(data, "resendFromEmail", "resend_from_email");
    // ✅ on first insert, default from email if not provided
    const resendFromEmail =
      resendFromEmailRaw !== undefined
        ? normalizeEmail(resendFromEmailRaw)
        : isFirstInsert
          ? normalizeEmail(DEFAULT_FROM_EMAIL)
          : existing?.resendFromEmail ?? null;

    if (!looksLikeEmail(leadToEmail)) {
      return json({ ok: false, error: "INVALID_LEAD_TO_EMAIL", message: "lead_to_email must be a valid email address." }, 400);
    }
    if (!looksLikeEmail(resendFromEmail)) {
      return json({ ok: false, error: "INVALID_FROM_EMAIL", message: "resend_from_email must be a valid email address." }, 400);
    }

    const emailSendModeRaw = pick<string | null>(data, "emailSendMode", "email_send_mode");
    // ✅ on first insert, default standard mode if not provided
    const emailSendMode =
      emailSendModeRaw !== undefined
        ? (String(emailSendModeRaw ?? "").trim() || null)
        : isFirstInsert
          ? DEFAULT_EMAIL_SEND_MODE
          : existing?.emailSendMode ?? null;

    const emailIdentityIdRaw = pick<string | null>(data, "emailIdentityId", "email_identity_id");
    const emailIdentityId =
      emailIdentityIdRaw !== undefined ? (emailIdentityIdRaw ?? null) : existing?.emailIdentityId ?? null;

    const aiModeRaw = pick<string | null>(data, "aiMode", "ai_mode");
    const aiMode = aiModeRaw !== undefined ? (aiModeRaw ?? null) : existing?.aiMode ?? null;

    const pricingEnabledRaw = pick<boolean | null>(data, "pricingEnabled", "pricing_enabled");
    const pricingEnabled = pricingEnabledRaw !== undefined ? pricingEnabledRaw : existing?.pricingEnabled ?? null;

    const renderingEnabledRaw = pick<boolean | null>(data, "renderingEnabled", "rendering_enabled");
    const renderingEnabled = renderingEnabledRaw !== undefined ? renderingEnabledRaw : existing?.renderingEnabled ?? null;

    const renderingStyleRaw = pick<string | null>(data, "renderingStyle", "rendering_style");
    const renderingStyle = renderingStyleRaw !== undefined ? (renderingStyleRaw ?? null) : existing?.renderingStyle ?? null;

    const renderingNotesRaw = pick<string | null>(data, "renderingNotes", "rendering_notes");
    const renderingNotes = renderingNotesRaw !== undefined ? (renderingNotesRaw ?? null) : existing?.renderingNotes ?? null;

    const renderingMaxPerDayRaw = pick<number | null>(data, "renderingMaxPerDay", "rendering_max_per_day");
    const renderingMaxPerDay =
      renderingMaxPerDayRaw !== undefined ? renderingMaxPerDayRaw : existing?.renderingMaxPerDay ?? null;

    const renderingCustomerOptInRequiredRaw = pick<boolean | null>(
      data,
      "renderingCustomerOptInRequired",
      "rendering_customer_opt_in_required"
    );
    const renderingCustomerOptInRequired =
      renderingCustomerOptInRequiredRaw !== undefined
        ? renderingCustomerOptInRequiredRaw
        : existing?.renderingCustomerOptInRequired ?? null;

    const aiRenderingEnabledRaw = pick<boolean | null>(data, "aiRenderingEnabled", "ai_rendering_enabled");
    const aiRenderingEnabled =
      aiRenderingEnabledRaw !== undefined ? aiRenderingEnabledRaw : existing?.aiRenderingEnabled ?? null;

    const reportingTimezoneRaw = pick<string | null>(data, "reportingTimezone", "reporting_timezone");
    const reportingTimezone =
      reportingTimezoneRaw !== undefined
        ? (String(reportingTimezoneRaw ?? "").trim() || null)
        : existing?.reportingTimezone ?? "America/New_York";

    const weekStartsOnRaw = pick<number | null>(data, "weekStartsOn", "week_starts_on");
    const weekStartsOn = weekStartsOnRaw !== undefined ? (weekStartsOnRaw ?? null) : existing?.weekStartsOn ?? 1;

    // ✅ Trial seed values (ONLY on first insert)
    const planSeed = isFirstInsert
      ? {
          planTier: DEFAULT_TRIAL_TIER,
          monthlyQuoteLimit: null,
          activationGraceCredits: DEFAULT_TRIAL_CREDITS,
          activationGraceUsed: 0,
          planSelectedAt: new Date(),
        }
      : {};

    await db
      .insert(tenantSettings)
      .values({
        tenantId: tenant.id,
        industryKey,
        redirectUrl,
        thankYouUrl,

        businessName,
        leadToEmail,
        resendFromEmail,

        emailSendMode,
        emailIdentityId,

        aiMode,
        pricingEnabled,
        renderingEnabled,
        renderingStyle,
        renderingNotes,
        renderingMaxPerDay,
        renderingCustomerOptInRequired,
        aiRenderingEnabled,

        reportingTimezone,
        weekStartsOn,

        ...planSeed,

        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: tenantSettings.tenantId,
        set: {
          industryKey,
          redirectUrl,
          thankYouUrl,

          businessName,
          leadToEmail,

          // ✅ only overwrite these if caller provided them explicitly
          ...(resendFromEmailRaw !== undefined ? { resendFromEmail } : {}),
          ...(emailSendModeRaw !== undefined ? { emailSendMode } : {}),
          ...(emailIdentityIdRaw !== undefined ? { emailIdentityId } : {}),

          aiMode,
          pricingEnabled,
          renderingEnabled,
          renderingStyle,
          renderingNotes,
          renderingMaxPerDay,
          renderingCustomerOptInRequired,
          aiRenderingEnabled,

          reportingTimezone,
          weekStartsOn,

          // ✅ DO NOT update plan fields here (never reset credits)

          updatedAt: new Date(),
        },
      });

    const settings = await db
      .select({
        tenant_id: tenantSettings.tenantId,
        industry_key: tenantSettings.industryKey,
        redirect_url: tenantSettings.redirectUrl,
        thank_you_url: tenantSettings.thankYouUrl,

        business_name: tenantSettings.businessName,
        lead_to_email: tenantSettings.leadToEmail,
        resend_from_email: tenantSettings.resendFromEmail,

        email_send_mode: tenantSettings.emailSendMode,
        email_identity_id: tenantSettings.emailIdentityId,

        ai_mode: tenantSettings.aiMode,
        pricing_enabled: tenantSettings.pricingEnabled,
        rendering_enabled: tenantSettings.renderingEnabled,
        rendering_style: tenantSettings.renderingStyle,
        rendering_notes: tenantSettings.renderingNotes,
        rendering_max_per_day: tenantSettings.renderingMaxPerDay,
        rendering_customer_opt_in_required: tenantSettings.renderingCustomerOptInRequired,
        ai_rendering_enabled: tenantSettings.aiRenderingEnabled,

        reporting_timezone: tenantSettings.reportingTimezone,
        week_starts_on: tenantSettings.weekStartsOn,

        plan_tier: tenantSettings.planTier,
        monthly_quote_limit: tenantSettings.monthlyQuoteLimit,
        activation_grace_credits: tenantSettings.activationGraceCredits,
        activation_grace_used: tenantSettings.activationGraceUsed,
        plan_selected_at: tenantSettings.planSelectedAt,

        updated_at: tenantSettings.updatedAt,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenant.id))
      .limit(1)
      .then((r) => r[0] ?? null);

    return json({
      ok: true,
      tenant: { id: tenant.id, slug: desiredSlug || tenant.slug },
      settings,
    });
  } catch (e: any) {
    return json({ ok: false, error: "INTERNAL", message: e?.message ?? String(e) }, 500);
  }
}