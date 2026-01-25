// src/app/api/tenant/save-settings/route.ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db/client";
import { tenants, tenantSettings } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Save tenant settings (industry, URLs, rendering settings, reporting prefs, email prefs, etc.)
 *
 * Goals:
 * - Allow PARTIAL updates (setup wizard pages shouldn't need to send every field).
 * - Require industryKey ONLY when creating tenant_settings for the first time.
 * - Preserve existing values when fields are omitted.
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

  // extra tenant_settings fields (optional)
  businessName: z.string().optional().nullable(),
  business_name: z.string().optional().nullable(),

  leadToEmail: z.string().optional().nullable(),
  lead_to_email: z.string().optional().nullable(),

  resendFromEmail: z.string().optional().nullable(),
  resend_from_email: z.string().optional().nullable(),

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

function getCookieTenantId(jar: Awaited<ReturnType<typeof cookies>>) {
  const candidates = [
    jar.get("activeTenantId")?.value,
    jar.get("active_tenant_id")?.value,
    jar.get("tenantId")?.value,
    jar.get("tenant_id")?.value,
  ].filter(Boolean) as string[];

  return candidates[0] || null;
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
  // lightweight validation; real validation happens at send-time too
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }

    const json = await req.json().catch(() => null);
    const parsed = Body.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "INVALID_BODY", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const data: any = parsed.data;

    // "desired slug" is what the client wants. We'll update tenant.slug if it differs.
    const desiredSlug = String(data.tenantSlug).trim();

    // Resolve tenant by cookie (active tenant) with fallback to first owned tenant
    const jar = await cookies();
    let tenantId = getCookieTenantId(jar);

    if (!tenantId) {
      const t = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.ownerClerkUserId, userId))
        .limit(1)
        .then((r) => r[0] ?? null);

      tenantId = t?.id ?? null;
    }

    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "NO_ACTIVE_TENANT" }, { status: 400 });
    }

    // Resolve tenant by id + ownership
    const tenant = await db
      .select({
        id: tenants.id,
        slug: tenants.slug,
        ownerClerkUserId: tenants.ownerClerkUserId,
      })
      .from(tenants)
      .where(and(eq(tenants.id, tenantId), eq(tenants.ownerClerkUserId, userId)))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!tenant) {
      return NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND_OR_NOT_OWNED" }, { status: 404 });
    }

    // ✅ Update tenant slug if changed (NOW tenant is defined)
    if (desiredSlug && desiredSlug !== tenant.slug) {
      await db.update(tenants).set({ slug: desiredSlug }).where(eq(tenants.id, tenant.id));
    }

    // Load existing settings (so we can merge partial updates safely)
    const existing = await db
      .select({
        tenantId: tenantSettings.tenantId,
        industryKey: tenantSettings.industryKey,
        redirectUrl: tenantSettings.redirectUrl,
        thankYouUrl: tenantSettings.thankYouUrl,

        businessName: tenantSettings.businessName,
        leadToEmail: tenantSettings.leadToEmail,
        resendFromEmail: tenantSettings.resendFromEmail,

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
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenant.id))
      .limit(1)
      .then((r) => r[0] ?? null);

    // Industry key: only required on FIRST insert (no existing row)
    const incomingIndustryKey = pick<string>(data, "industryKey", "industry_key")?.trim();
    const industryKey = incomingIndustryKey ?? existing?.industryKey ?? "";

    if (!industryKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_INDUSTRY_KEY",
          message: "industryKey is required the first time settings are saved.",
        },
        { status: 400 }
      );
    }

    const redirectUrlRaw = pick<string | null>(data, "redirectUrl", "redirect_url");
    const thankYouUrlRaw = pick<string | null>(data, "thankYouUrl", "thank_you_url");

    const redirectUrl =
      redirectUrlRaw !== undefined ? normalizeUrl(redirectUrlRaw) : existing?.redirectUrl ?? null;

    const thankYouUrl =
      thankYouUrlRaw !== undefined ? normalizeUrl(thankYouUrlRaw) : existing?.thankYouUrl ?? null;

    const businessNameRaw = pick<string | null>(data, "businessName", "business_name");
    const businessName =
      businessNameRaw !== undefined
        ? (String(businessNameRaw ?? "").trim() || null)
        : existing?.businessName ?? null;

    const leadToEmailRaw = pick<string | null>(data, "leadToEmail", "lead_to_email");
    const leadToEmail =
      leadToEmailRaw !== undefined ? normalizeEmail(leadToEmailRaw) : existing?.leadToEmail ?? null;

    const resendFromEmailRaw = pick<string | null>(data, "resendFromEmail", "resend_from_email");
    const resendFromEmail =
      resendFromEmailRaw !== undefined ? normalizeEmail(resendFromEmailRaw) : existing?.resendFromEmail ?? null;

    if (!looksLikeEmail(leadToEmail)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_LEAD_TO_EMAIL", message: "lead_to_email must be a valid email address." },
        { status: 400 }
      );
    }
    if (!looksLikeEmail(resendFromEmail)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_FROM_EMAIL", message: "resend_from_email must be a valid email address." },
        { status: 400 }
      );
    }

    const aiModeRaw = pick<string | null>(data, "aiMode", "ai_mode");
    const aiMode = aiModeRaw !== undefined ? (aiModeRaw ?? null) : existing?.aiMode ?? null;

    const pricingEnabledRaw = pick<boolean | null>(data, "pricingEnabled", "pricing_enabled");
    const pricingEnabled =
      pricingEnabledRaw !== undefined ? pricingEnabledRaw : existing?.pricingEnabled ?? null;

    const renderingEnabledRaw = pick<boolean | null>(data, "renderingEnabled", "rendering_enabled");
    const renderingEnabled =
      renderingEnabledRaw !== undefined ? renderingEnabledRaw : existing?.renderingEnabled ?? null;

    const renderingStyleRaw = pick<string | null>(data, "renderingStyle", "rendering_style");
    const renderingStyle =
      renderingStyleRaw !== undefined ? (renderingStyleRaw ?? null) : existing?.renderingStyle ?? null;

    const renderingNotesRaw = pick<string | null>(data, "renderingNotes", "rendering_notes");
    const renderingNotes =
      renderingNotesRaw !== undefined ? (renderingNotesRaw ?? null) : existing?.renderingNotes ?? null;

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
    const weekStartsOn =
      weekStartsOnRaw !== undefined ? (weekStartsOnRaw ?? null) : existing?.weekStartsOn ?? 1;

    // Upsert tenant_settings (tenant_id is PK)
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
          resendFromEmail,
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

          updatedAt: new Date(),
        },
      });

    // Return saved settings (snake_case response)
    const settingsRows = await db
      .select({
        tenant_id: tenantSettings.tenantId,
        industry_key: tenantSettings.industryKey,
        redirect_url: tenantSettings.redirectUrl,
        thank_you_url: tenantSettings.thankYouUrl,

        business_name: tenantSettings.businessName,
        lead_to_email: tenantSettings.leadToEmail,
        resend_from_email: tenantSettings.resendFromEmail,
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

        updated_at: tenantSettings.updatedAt,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenant.id))
      .limit(1);

    return NextResponse.json({
      ok: true,
      tenant: { id: tenant.id, slug: desiredSlug || tenant.slug },
      settings: settingsRows[0] ?? null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}