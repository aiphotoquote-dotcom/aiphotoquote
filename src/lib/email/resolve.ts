// src/lib/email/resolve.ts
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export type TenantEmailConfig = {
  businessName: string | null;
  leadToEmail: string | null;
  resendFromEmail: string | null; // tenant preferred "From" (may be unverified)
  emailSendMode: "standard" | "enterprise" | null;

  // enterprise/oauth placeholder
  emailIdentityId: string | null;
};

export async function getTenantEmailConfig(tenantId: string): Promise<TenantEmailConfig> {
  const r = await db.execute(sql`
    select
      business_name,
      lead_to_email,
      resend_from_email,
      email_send_mode,
      email_identity_id
    from tenant_settings
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);

  const row: any =
    (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

  const modeRaw = (row?.email_send_mode ?? "standard").toString().trim().toLowerCase();
  const emailSendMode: "standard" | "enterprise" =
    modeRaw === "enterprise" ? "enterprise" : "standard";

  const emailIdentityId = row?.email_identity_id ? String(row.email_identity_id) : null;

  return {
    businessName: row?.business_name ?? null,
    leadToEmail: row?.lead_to_email ?? null,
    resendFromEmail: row?.resend_from_email ?? null,
    emailSendMode,
    emailIdentityId,
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

  // Mode-aware intent (no behavior difference today)
  // - standard: platformFrom + Reply-To tenant inbox
  // - enterprise: still platformFrom for now, Reply-To tenant inbox (until OAuth providers exist)
  return {
    from: platformFrom,
    replyTo: tenantReplyTo ? [tenantReplyTo] : [],
  };
}

/**
 * Convenience helper for routes that want to display exactly what will be used.
 * (Keeps UI code clean and avoids duplicating replyTo[0] handling everywhere.)
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