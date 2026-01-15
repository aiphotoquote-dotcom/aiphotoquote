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

  const platformHasResendKey = !!process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.trim().length > 0;

  const r = await db.execute(sql`
    select business_name, lead_to_email, resend_from_email
    from tenant_settings
    where tenant_id = ${gate.tenantId}::uuid
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

  const business_name = (row?.business_name ?? "").trim();
  const lead_to_email = (row?.lead_to_email ?? "").trim();
  const resend_from_email = (row?.resend_from_email ?? "").trim();

  const tenantHasBusinessName = business_name.length > 0;
  const tenantHasLeadToEmail = lead_to_email.length > 0;
  const tenantHasFromEmail = resend_from_email.length > 0;

  // NOTE: We can’t verify the Resend domain here without calling Resend.
  // This is "configuration readiness", not "deliverability guaranteed".
  const enabled = platformHasResendKey && tenantHasBusinessName && tenantHasLeadToEmail && tenantHasFromEmail;

  return json({
    ok: true,
    tenantId: gate.tenantId,
    role: gate.role,
    platform: {
      resend_key_present: platformHasResendKey,
    },
    tenant: {
      business_name_present: tenantHasBusinessName,
      lead_to_email_present: tenantHasLeadToEmail,
      resend_from_email_present: tenantHasFromEmail,
    },
    enabled,
    notes: enabled
      ? ["Email is configured (domain verification still required for the From address)."]
      : [
          ...(platformHasResendKey ? [] : ["Platform missing RESEND_API_KEY."]),
          ...(tenantHasBusinessName ? [] : ["Tenant missing business_name."]),
          ...(tenantHasLeadToEmail ? [] : ["Tenant missing lead_to_email."]),
          ...(tenantHasFromEmail ? [] : ["Tenant missing resend_from_email."]),
        ],
  });
}
