// src/lib/email/tenantEmail.ts
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export async function getTenantEmailConfig(tenantId: string) {
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
    businessName: (row?.business_name ?? "").toString().trim() || null,
    leadToEmail: (row?.lead_to_email ?? "").toString().trim() || null,
    fromEmail: (row?.resend_from_email ?? "").toString().trim() || null,

    // NEW (for later routing)
    sendMode: (row?.email_send_mode ?? "").toString().trim() || null, // "standard" | "enterprise"
    emailIdentityId: row?.email_identity_id ? String(row.email_identity_id) : null,
  };
}