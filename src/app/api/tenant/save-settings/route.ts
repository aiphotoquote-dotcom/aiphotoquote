// src/app/api/tenant/save-settings/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db/client";
import { tenants, tenantSettings } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Save tenant settings (industry, URLs, rendering settings, reporting prefs, etc.)
 *
 * IMPORTANT:
 * - Clerk auth() is async in this repo setup -> must await.
 * - Do NOT use db.query.* (db isn't typed with schema generics). Use select/from/where.
 *
 * DB columns (confirmed):
 * tenant_settings.reporting_timezone (text)
 * tenant_settings.week_starts_on (integer)   // 1=Monday ... 7=Sunday (we'll use 1 default)
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

  // reporting prefs (NEW)
  reportingTimezone: z.string().optional().nullable(),
  reporting_timezone: z.string().optional().nullable(),

  // 1..7 (Monday..Sunday). We'll default to 1
  weekStartsOn: z.number().int().min(1).max(7).optional().nullable(),
  week_starts_on: z.number().int().min(1).max(7).optional().nullable(),
});

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

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "UNAUTHENTICATED" },
        { status: 401 }
      );
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

    const tenantSlug = String(data.tenantSlug).trim();

    const industryKey =
      pick<string>(data, "industryKey", "industry_key")?.trim() ?? "";

    if (!industryKey) {
      return NextResponse.json(
        { ok: false, error: "MISSING_INDUSTRY_KEY" },
        { status: 400 }
      );
    }

    // Resolve tenant owned by this user (slug is unique)
    const tenantRows = await db
      .select({
        id: tenants.id,
        slug: tenants.slug,
        ownerClerkUserId: tenants.ownerClerkUserId,
      })
      .from(tenants)
      .where(and(eq(tenants.slug, tenantSlug), eq(tenants.ownerClerkUserId, userId)))
      .limit(1);

    const tenant = tenantRows[0] ?? null;
    if (!tenant) {
      return NextResponse.json(
        { ok: false, error: "TENANT_NOT_FOUND_OR_NOT_OWNED" },
        { status: 404 }
      );
    }

    const redirectUrlRaw = pick<string | null>(data, "redirectUrl", "redirect_url");
    const thankYouUrlRaw = pick<string | null>(data, "thankYouUrl", "thank_you_url");

    const redirectUrl = normalizeUrl(redirectUrlRaw ?? null);
    const thankYouUrl = normalizeUrl(thankYouUrlRaw ?? null);

    const businessName = pick<string | null>(data, "businessName", "business_name") ?? null;
    const leadToEmail = pick<string | null>(data, "leadToEmail", "lead_to_email") ?? null;
    const resendFromEmail =
      pick<string | null>(data, "resendFromEmail", "resend_from_email") ?? null;

    const aiMode = pick<string | null>(data, "aiMode", "ai_mode") ?? null;

    const pricingEnabled =
      pick<boolean | null>(data, "pricingEnabled", "pricing_enabled") ?? null;

    const renderingEnabled =
      pick<boolean | null>(data, "renderingEnabled", "rendering_enabled") ?? null;

    const renderingStyle = pick<string | null>(data, "renderingStyle", "rendering_style") ?? null;
    const renderingNotes = pick<string | null>(data, "renderingNotes", "rendering_notes") ?? null;

    const renderingMaxPerDay =
      pick<number | null>(data, "renderingMaxPerDay", "rendering_max_per_day") ?? null;

    const renderingCustomerOptInRequired =
      pick<boolean | null>(
        data,
        "renderingCustomerOptInRequired",
        "rendering_customer_opt_in_required"
      ) ?? null;

    const aiRenderingEnabled =
      pick<boolean | null>(data, "aiRenderingEnabled", "ai_rendering_enabled") ?? null;

    const reportingTimezone =
      pick<string | null>(data, "reportingTimezone", "reporting_timezone") ??
      "America/New_York";

    const weekStartsOn =
      pick<number | null>(data, "weekStartsOn", "week_starts_on") ?? 1; // Monday default

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
      tenant: { id: tenant.id, slug: tenant.slug },
      settings: settingsRows[0] ?? null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
