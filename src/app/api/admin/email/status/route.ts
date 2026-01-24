// src/app/api/admin/email/status/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requireTenantRole } from "@/lib/auth/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

export async function GET() {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status);

  const platformHasResendKey =
    !!process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.trim().length > 0;

  const r = await db.execute(sql`
    select business_name, lead_to_email, resend_from_email, email_send_mode, email_identity_id
    from tenant_settings
    where tenant_id = ${gate.tenantId}::uuid
    limit 1
  `);

  const row: any =
    (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

  const business_name = (row?.business_name ?? "").trim();
  const lead_to_email = (row?.lead_to_email ?? "").trim();
  const resend_from_email = (row?.resend_from_email ?? "").trim();

  const email_send_mode_raw = (row?.email_send_mode ?? "standard")
    .toString()
    .trim()
    .toLowerCase();
  const email_send_mode =
    email_send_mode_raw === "enterprise" ? "enterprise" : "standard";

  const email_identity_id = row?.email_identity_id ?? null;

  const tenantHasBusinessName = business_name.length > 0;
  const tenantHasLeadToEmail = lead_to_email.length > 0;
  const tenantHasFromEmail = resend_from_email.length > 0;

  const tenantHasEnterpriseIdentity = Boolean(email_identity_id);

  // Readiness rules:
  // - Standard: needs Resend + business_name + lead_to_email + resend_from_email
  // - Enterprise: needs business_name + lead_to_email + email_identity_id
  //
  // NOTE: We can’t verify DNS (standard) or OAuth token validity (enterprise) here without provider calls.
  const enabled =
    email_send_mode === "enterprise"
      ? tenantHasBusinessName && tenantHasLeadToEmail && tenantHasEnterpriseIdentity
      : platformHasResendKey &&
        tenantHasBusinessName &&
        tenantHasLeadToEmail &&
        tenantHasFromEmail;

  const notes: string[] = [];
  if (enabled) {
    notes.push(
      email_send_mode === "enterprise"
        ? "Enterprise (OAuth) email is configured (token validity still required)."
        : "Email is configured (domain verification still required for the From address)."
    );
  } else {
    if (email_send_mode === "enterprise") {
      if (!tenantHasBusinessName) notes.push("Tenant missing business_name.");
      if (!tenantHasLeadToEmail) notes.push("Tenant missing lead_to_email.");
      if (!tenantHasEnterpriseIdentity)
        notes.push("Tenant missing email_identity_id (connect an OAuth mailbox).");
    } else {
      if (!platformHasResendKey) notes.push("Platform missing RESEND_API_KEY.");
      if (!tenantHasBusinessName) notes.push("Tenant missing business_name.");
      if (!tenantHasLeadToEmail) notes.push("Tenant missing lead_to_email.");
      if (!tenantHasFromEmail) notes.push("Tenant missing resend_from_email.");
    }
  }

  return json({
    ok: true,
    tenantId: gate.tenantId,
    role: gate.role,
    enabled,
    notes,
    platform: {
      resend_key_present: platformHasResendKey,
    },
    tenant: {
      // keep the original “standard readiness” booleans for UI compatibility
      business_name_present: tenantHasBusinessName,
      lead_to_email_present: tenantHasLeadToEmail,
      resend_from_email_present: tenantHasFromEmail,

      // NEW (preferred): match what your UI already expects
      email_send_mode,
      email_identity_id_present: tenantHasEnterpriseIdentity,
    },

    // Legacy/compat bucket (safe to keep; optional)
    enterprise: {
      email_send_mode,
      email_identity_id_present: tenantHasEnterpriseIdentity,
    },
  });
}