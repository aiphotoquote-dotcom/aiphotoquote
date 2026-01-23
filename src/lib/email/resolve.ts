// src/lib/email/resolve.ts
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export type TenantEmailConfig = {
  businessName: string | null;
  leadToEmail: string | null;
  resendFromEmail: string | null; // tenant preferred "From" (may be unverified)
  emailSendMode: "standard" | "enterprise" | null;
  // for later:
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

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

  return {
    businessName: row?.business_name ?? null,
    leadToEmail: row?.lead_to_email ?? null,
    resendFromEmail: row?.resend_from_email ?? null,
    emailSendMode: row?.email_send_mode ?? null,
    emailIdentityId: row?.email_identity_id ?? null,
  };
}

export function resolveFromAndReplyTo(cfg: TenantEmailConfig) {
  // ✅ platform fallback always deliverable
  const platformFrom = process.env.PLATFORM_FROM_EMAIL?.trim() || "AI Photo Quote <no-reply@aiphotoquote.com>";

  const tenantReplyTo = cfg.leadToEmail?.trim() || undefined;

  // For now we ALWAYS use platformFrom to avoid “domain not verified” hard-fail.
  // Later we’ll allow tenant resendFromEmail after we can verify/allowlist their domain.
  return {
    from: platformFrom,
    replyTo: tenantReplyTo ? [tenantReplyTo] : undefined,
  };
}