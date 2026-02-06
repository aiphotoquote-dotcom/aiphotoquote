// src/app/api/tenant/me-settings/route.ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants, tenantSettings } from "@/lib/db/schema";
import { requireTenantRole } from "@/lib/auth/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BrandLogoVariant = "auto" | "light" | "dark";

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

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function safeNullableText(v: unknown): string | null {
  const s = safeTrim(v);
  return s ? s : null;
}

function safeBrandLogoVariant(v: unknown): BrandLogoVariant {
  const s = safeTrim(v).toLowerCase();
  if (s === "light") return "light";
  if (s === "dark") return "dark";
  return "auto";
}

/**
 * Tenant "me-settings" for the ACTIVE tenant.
 * RBAC + active tenant resolution is handled by requireTenantRole (cookie + tenant_members).
 *
 * IMPORTANT:
 * - No "fallback to first tenant" (causes tenant drift).
 * - If no active tenant cookie, client must call /api/tenant/context and/or use tenant switcher.
 */
export async function GET() {
  const gate = await requireTenantRole(["owner", "admin", "member"]);
  if (!gate.ok) return json({ ok: false, error: gate.error, message: gate.message }, gate.status);

  try {
    const tenant = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
      })
      .from(tenants)
      .where(eq(tenants.id, gate.tenantId as any))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!tenant) return json({ ok: false, error: "TENANT_NOT_FOUND" }, 404);

    // ✅ Return the fields our onboarding + email settings UIs actually use.
    // If your DB is missing any of these columns, the build will still succeed,
    // but the runtime query will fail — so make sure migrations are applied in prod.
    const settings = await db
      .select({
        tenant_id: tenantSettings.tenantId,
        industry_key: tenantSettings.industryKey,
        redirect_url: tenantSettings.redirectUrl,
        thank_you_url: tenantSettings.thankYouUrl,

        business_name: tenantSettings.businessName,
        lead_to_email: tenantSettings.leadToEmail,
        resend_from_email: tenantSettings.resendFromEmail,

        brand_logo_url: tenantSettings.brandLogoUrl,
        brand_logo_variant: tenantSettings.brandLogoVariant,

        email_send_mode: tenantSettings.emailSendMode,
        email_identity_id: tenantSettings.emailIdentityId,

        updated_at: tenantSettings.updatedAt,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenant.id))
      .limit(1)
      .then((r) => r[0] ?? null);

    return json({ ok: true, tenant, settings });
  } catch (e: any) {
    return json(
      {
        ok: false,
        error: "INTERNAL",
        message: e?.message ?? String(e),
        code: e?.code,
        detail: e?.detail,
        hint: e?.hint,
      },
      500
    );
  }
}

/**
 * Update tenant settings for ACTIVE tenant.
 *
 * Accepts partial updates. Any omitted fields are left unchanged.
 *
 * Expected JSON (any subset):
 * {
 *   redirectUrl?: string | null,
 *   thankYouUrl?: string | null,
 *   businessName?: string | null,
 *   leadToEmail?: string | null,
 *   resendFromEmail?: string | null,
 *   brandLogoUrl?: string | null,
 *   brandLogoVariant?: "auto" | "light" | "dark" | null,
 *   emailSendMode?: string | null,
 *   emailIdentityId?: string | null
 * }
 */
export async function POST(req: Request) {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) return json({ ok: false, error: gate.error, message: gate.message }, gate.status);

  try {
    const body = (await req.json().catch(() => null)) as any | null;
    if (!body || typeof body !== "object") {
      return json({ ok: false, error: "INVALID_JSON", message: "Body must be JSON." }, 400);
    }

    const patch: Record<string, any> = {};
    const setIfPresent = (key: string, value: any) => {
      if (value !== undefined) patch[key] = value;
    };

    setIfPresent("redirectUrl", safeNullableText(body.redirectUrl));
    setIfPresent("thankYouUrl", safeNullableText(body.thankYouUrl));

    setIfPresent("businessName", safeNullableText(body.businessName));
    setIfPresent("leadToEmail", safeNullableText(body.leadToEmail));
    setIfPresent("resendFromEmail", safeNullableText(body.resendFromEmail));

    setIfPresent("brandLogoUrl", safeNullableText(body.brandLogoUrl));

    // allow null -> store null? (we store a NOT NULL default 'auto' column, so null means "auto")
    if (body.brandLogoVariant !== undefined) {
      const v = safeTrim(body.brandLogoVariant);
      patch.brandLogoVariant = v ? safeBrandLogoVariant(v) : "auto";
    }

    setIfPresent("emailSendMode", safeNullableText(body.emailSendMode));

    // emailIdentityId should be uuid string or null
    if (body.emailIdentityId !== undefined) {
      const s = safeTrim(body.emailIdentityId);
      patch.emailIdentityId = s ? s : null;
    }

    // nothing to update
    if (Object.keys(patch).length === 0) {
      return json({ ok: true, updated: false });
    }

    // Ensure we always have industryKey for inserts
    // (your schema makes industry_key NOT NULL).
    const existing = await db
      .select({
        industry_key: tenantSettings.industryKey,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, gate.tenantId as any))
      .limit(1)
      .then((r) => r[0] ?? null);

    const industryKey = safeTrim(body.industryKey) || existing?.industry_key || "service";

    // ✅ Upsert settings row
    await db
      .insert(tenantSettings)
      .values({
        tenantId: gate.tenantId as any,
        industryKey,
        ...patch,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: tenantSettings.tenantId,
        set: {
          ...patch,
          updatedAt: new Date(),
        },
      });

    // Return fresh settings
    const settings = await db
      .select({
        tenant_id: tenantSettings.tenantId,
        industry_key: tenantSettings.industryKey,
        redirect_url: tenantSettings.redirectUrl,
        thank_you_url: tenantSettings.thankYouUrl,

        business_name: tenantSettings.businessName,
        lead_to_email: tenantSettings.leadToEmail,
        resend_from_email: tenantSettings.resendFromEmail,

        brand_logo_url: tenantSettings.brandLogoUrl,
        brand_logo_variant: tenantSettings.brandLogoVariant,

        email_send_mode: tenantSettings.emailSendMode,
        email_identity_id: tenantSettings.emailIdentityId,

        updated_at: tenantSettings.updatedAt,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, gate.tenantId as any))
      .limit(1)
      .then((r) => r[0] ?? null);

    return json({ ok: true, updated: true, settings });
  } catch (e: any) {
    return json(
      {
        ok: false,
        error: "INTERNAL",
        message: e?.message ?? String(e),
        code: e?.code,
        detail: e?.detail,
        hint: e?.hint,
      },
      500
    );
  }
}