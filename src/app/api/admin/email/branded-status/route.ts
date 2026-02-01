// src/app/api/admin/email/branded-status/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { Resend } from "resend";

import { db } from "@/lib/db/client";
import { requireTenantRole } from "@/lib/auth/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

function extractEmail(raw: string): string {
  const s = String(raw ?? "").trim();
  // Supports: "Name <email@domain.com>" OR "email@domain.com"
  const m = s.match(/<([^>]+)>/);
  return (m?.[1] ?? s).trim();
}

function extractDomainFromFrom(rawFrom: string): string | null {
  const email = extractEmail(rawFrom);
  const at = email.lastIndexOf("@");
  if (at <= 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

export async function GET() {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status);

  const resendKey = (process.env.RESEND_API_KEY ?? "").trim();
  const platformHasResendKey = resendKey.length > 0;

  // Pull tenant's from address
  const r = await db.execute(sql`
    select resend_from_email
    from tenant_settings
    where tenant_id = ${gate.tenantId}::uuid
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  const resend_from_email = (row?.resend_from_email ?? "").toString().trim();

  const domain = resend_from_email ? extractDomainFromFrom(resend_from_email) : null;

  // Basic readiness (just for UI)
  const notes: string[] = [];
  if (!platformHasResendKey) notes.push("Platform missing RESEND_API_KEY.");
  if (!resend_from_email) notes.push("Tenant missing resend_from_email.");
  if (resend_from_email && !domain) notes.push("Could not parse a domain from resend_from_email.");

  // If we can’t even check, return gracefully
  if (!platformHasResendKey || !domain) {
    return json({
      ok: true,
      enabled: false,
      tenantId: gate.tenantId,
      role: gate.role,
      fromEmail: resend_from_email || null,
      domain,
      domainFoundInResend: false,
      domainStatus: null,
      domainId: null,
      records: [],
      notes,
    });
  }

  const resend = new Resend(resendKey);

  try {
    // List domains and find match by name
    const listOut = await (resend as any).domains.list();
    const listData = (listOut as any)?.data ?? null;

    const domains: any[] = Array.isArray(listData) ? listData : [];
    const match = domains.find((d) => String(d?.name ?? "").toLowerCase() === domain) ?? null;

    if (!match?.id) {
      return json({
        ok: true,
        enabled: false,
        tenantId: gate.tenantId,
        role: gate.role,
        fromEmail: resend_from_email,
        domain,
        domainFoundInResend: false,
        domainStatus: null,
        domainId: null,
        records: [],
        notes: [
          ...notes,
          `Domain "${domain}" is not added in Resend yet. Add it in Resend first (or we can automate create/verify next).`,
        ],
      });
    }

    // Retrieve domain for full record list + statuses
    const getOut = await (resend as any).domains.get(String(match.id));
    const d = (getOut as any)?.data ?? null;

    const domainStatus = d?.status ?? null;
    const records = Array.isArray(d?.records) ? d.records : [];

    // Decide “enabled” here as “domain looks verified enough to send”
    // (Resend uses statuses like not_started/pending/verified/etc; we don’t hardcode too tightly)
    const statusStr = String(domainStatus ?? "").toLowerCase();
    const looksVerified = statusStr === "verified" || statusStr === "active";

    return json({
      ok: true,
      enabled: looksVerified,
      tenantId: gate.tenantId,
      role: gate.role,
      fromEmail: resend_from_email,
      domain,
      domainFoundInResend: true,
      domainStatus,
      domainId: String(match.id),
      records,
      notes: [
        ...notes,
        looksVerified
          ? "Domain appears verified in Resend for sending."
          : "Domain is not verified yet — add DNS records and re-check.",
      ],
    });
  } catch (e: any) {
    return json(
      {
        ok: false,
        error: "RESEND_DOMAIN_LOOKUP_FAILED",
        message: e?.message ?? String(e),
      },
      500
    );
  }
}