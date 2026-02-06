// src/lib/email/resolve.ts
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export type BrandLogoVariant = "auto" | "light" | "dark";

export type TenantEmailConfig = {
  businessName: string | null;
  leadToEmail: string | null;

  // tenant preferred "From" (may be unverified)
  resendFromEmail: string | null;
  emailSendMode: "standard" | "enterprise" | null;

  // enterprise/oauth placeholder
  emailIdentityId: string | null;

  // ✅ Branding for templates
  brandLogoUrl: string | null;
  brandLogoVariant: BrandLogoVariant; // auto | light | dark
};

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function normalizeVariant(v: unknown): BrandLogoVariant {
  const s = safeTrim(v).toLowerCase();
  if (s === "light") return "light";
  if (s === "dark") return "dark";
  return "auto";
}

export async function getTenantEmailConfig(tenantId: string): Promise<TenantEmailConfig> {
  const r = await db.execute(sql`
    select
      business_name,
      lead_to_email,
      resend_from_email,
      email_send_mode,
      email_identity_id,
      brand_logo_url,
      brand_logo_variant
    from tenant_settings
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

  const modeRaw = safeTrim(row?.email_send_mode).toLowerCase();
  const emailSendMode: "standard" | "enterprise" = modeRaw === "enterprise" ? "enterprise" : "standard";
  const emailIdentityId = row?.email_identity_id ? String(row.email_identity_id) : null;

  const brandLogoUrl = safeTrim(row?.brand_logo_url) || null;
  const brandLogoVariant = normalizeVariant(row?.brand_logo_variant);

  return {
    businessName: row?.business_name ?? null,
    leadToEmail: row?.lead_to_email ?? null,
    resendFromEmail: row?.resend_from_email ?? null,
    emailSendMode,
    emailIdentityId,

    brandLogoUrl,
    brandLogoVariant,
  };
}

/**
 * Helper for UI/debug displays (test email page, logs, etc).
 * NOTE: Real provider selection happens in src/lib/email/index.ts routing.
 */
export function describeTenantEmailMode(cfg: TenantEmailConfig): {
  mode: "standard" | "enterprise";
  providerLabel: string; // human-friendly
} {
  const mode = cfg.emailSendMode === "enterprise" ? "enterprise" : "standard";
  return {
    mode,
    providerLabel: mode === "enterprise" ? "oauth_mailbox" : "resend",
  };
}

/**
 * Determines the "From" + "Reply-To" headers to use for outbound email content.
 *
 * IMPORTANT:
 * - For now we ALWAYS use PLATFORM_FROM_EMAIL as the actual "From" to avoid
 *   “domain not verified” hard-fails.
 * - Reply-To is set to the tenant lead inbox so replies land in the tenant's mailbox.
 *
 * Later (when safe):
 * - Standard mode: allow tenant resendFromEmail if verified/allowlisted
 * - Enterprise mode: set From to the OAuth mailbox identity
 */
export function resolveFromAndReplyTo(cfg: TenantEmailConfig): {
  from: string;
  replyTo: string[];
} {
  const platformFrom =
    process.env.PLATFORM_FROM_EMAIL?.trim() || "AI Photo Quote <no-reply@aiphotoquote.com>";

  const tenantReplyTo = cfg.leadToEmail?.trim() || "";

  return {
    from: platformFrom,
    replyTo: tenantReplyTo ? [tenantReplyTo] : [],
  };
}

/**
 * ✅ Branding helper for email templates.
 *
 * - variant "auto" lets templates choose based on their background/theme.
 * - "light" means prefer a logo that looks best on light backgrounds (dark logo).
 * - "dark" means prefer a logo that looks best on dark backgrounds (white/light logo).
 *
 * Today we only store one URL. Variant is a rendering hint.
 * Later we can add: brand_logo_url_light + brand_logo_url_dark if you want.
 */
export function resolveBrandingForEmail(cfg: TenantEmailConfig): {
  logoUrl: string | null;
  logoVariant: BrandLogoVariant;
  businessName: string;
} {
  const businessName = safeTrim(cfg.businessName) || "your business";
  return {
    logoUrl: cfg.brandLogoUrl ? safeTrim(cfg.brandLogoUrl) : null,
    logoVariant: normalizeVariant(cfg.brandLogoVariant),
    businessName,
  };
}

/**
 * Convenience helper for routes that want to display exactly what will be used.
 */
export function resolveEmailHeadersForDisplay(cfg: TenantEmailConfig): {
  mode: "standard" | "enterprise";
  providerLabel: string;
  fromUsed: string;
  replyToUsed: string | null;
} {
  const { mode, providerLabel } = describeTenantEmailMode(cfg);
  const { from, replyTo } = resolveFromAndReplyTo(cfg);

  return {
    mode,
    providerLabel,
    fromUsed: from,
    replyToUsed: replyTo?.[0] ?? null,
  };
}