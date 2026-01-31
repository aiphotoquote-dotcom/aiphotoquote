// src/app/api/admin/tenant-settings/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requireTenantRole } from "@/lib/auth/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

// Accepts either:
// - a real URL string (https://...)
// - null
// - "" (treated as null)
const BrandLogoUrl = z.preprocess((v) => {
  if (typeof v === "string" && v.trim() === "") return null;
  return v;
}, z.string().trim().url().max(500).nullable());

const PostBody = z.object({
  business_name: z.string().trim().min(1).max(120),
  lead_to_email: z.string().trim().email().max(200),
  resend_from_email: z.string().trim().min(5).max(200), // "Name <email@domain>"

  // tenant branding (logo URL)
  brand_logo_url: BrandLogoUrl.optional(),

  // enterprise/oauth
  email_send_mode: z.enum(["standard", "enterprise"]).optional(),
  email_identity_id: z.string().uuid().nullable().optional(),
});

async function getTenantSettingsRow(tenantId: string) {
  const r = await db.execute(sql`
    select
      tenant_id,
      business_name,
      lead_to_email,
      resend_from_email,
      brand_logo_url,
      email_send_mode,
      email_identity_id
    from tenant_settings
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  return row ?? null;
}

async function upsertTenantEmailSettings(tenantId: string, data: z.infer<typeof PostBody>) {
  const emailSendMode = ((data.email_send_mode ?? "standard").toString().trim().toLowerCase() === "enterprise"
    ? "enterprise"
    : "standard") as "standard" | "enterprise";

  // If field not present: preserve existing
  // If present and null: clear
  // If present and uuid: set
  const emailIdentityId =
    emailSendMode === "enterprise" && ("email_identity_id" in data)
      ? (data.email_identity_id ?? null)
      : undefined;

  // Same semantics for logo
  const brandLogoUrl = "brand_logo_url" in data ? (data.brand_logo_url ?? null) : undefined;

  // 1) Try update first
  const upd = await db.execute(sql`
    update tenant_settings
    set
      business_name = ${data.business_name},
      lead_to_email = ${data.lead_to_email},
      resend_from_email = ${data.resend_from_email},

      brand_logo_url = ${brandLogoUrl === undefined ? sql`brand_logo_url` : brandLogoUrl},

      email_send_mode = ${emailSendMode},
      email_identity_id = ${emailIdentityId === undefined ? sql`email_identity_id` : emailIdentityId},

      updated_at = now()
    where tenant_id = ${tenantId}::uuid
    returning tenant_id
  `);

  const updatedRow: any = (upd as any)?.rows?.[0] ?? (Array.isArray(upd) ? (upd as any)[0] : null);
  if (updatedRow?.tenant_id) return await getTenantSettingsRow(tenantId);

  // 2) Insert if missing (IMPORTANT: your table has NO id/created_at columns)
  await db.execute(sql`
    insert into tenant_settings
      (
        tenant_id,
        industry_key,
        business_name,
        lead_to_email,
        resend_from_email,
        brand_logo_url,
        email_send_mode,
        email_identity_id,
        updated_at
      )
    values
      (
        ${tenantId}::uuid,
        'auto',
        ${data.business_name},
        ${data.lead_to_email},
        ${data.resend_from_email},
        ${"brand_logo_url" in data ? (data.brand_logo_url ?? null) : null},
        ${emailSendMode},
        ${emailSendMode === "enterprise" ? (data.email_identity_id ?? null) : null},
        now()
      )
  `);

  return await getTenantSettingsRow(tenantId);
}

export async function GET() {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status);

  const settings = await getTenantSettingsRow(gate.tenantId);

  return json({
    ok: true,
    tenantId: gate.tenantId,
    role: gate.role,
    settings: {
      business_name: settings?.business_name ?? "",
      lead_to_email: settings?.lead_to_email ?? "",
      resend_from_email: settings?.resend_from_email ?? "",

      brand_logo_url: settings?.brand_logo_url ?? null,

      email_send_mode: settings?.email_send_mode ?? "standard",
      email_identity_id: settings?.email_identity_id ?? null,
    },
  });
}

export async function POST(req: Request) {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status);

  const body = await req.json().catch(() => null);
  const parsed = PostBody.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, 400);
  }

  try {
    const saved = await upsertTenantEmailSettings(gate.tenantId, parsed.data);
    return json({
      ok: true,
      tenantId: gate.tenantId,
      role: gate.role,
      settings: {
        business_name: saved?.business_name ?? "",
        lead_to_email: saved?.lead_to_email ?? "",
        resend_from_email: saved?.resend_from_email ?? "",

        brand_logo_url: saved?.brand_logo_url ?? null,

        email_send_mode: saved?.email_send_mode ?? "standard",
        email_identity_id: saved?.email_identity_id ?? null,
      },
    });
  } catch (e: any) {
    return json(
      {
        ok: false,
        error: "DB_WRITE_FAILED",
        message: e?.message ?? String(e),
        code: e?.code,
        detail: e?.detail,
        hint: e?.hint,
      },
      500
    );
  }
}