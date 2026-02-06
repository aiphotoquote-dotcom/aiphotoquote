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

const BrandLogoVariant = z
  .enum(["auto", "light", "dark"])
  .optional()
  .transform((v) => v ?? undefined);

const PostBody = z.object({
  business_name: z.string().trim().min(1).max(120),
  lead_to_email: z.string().trim().email().max(200),
  resend_from_email: z.string().trim().min(5).max(200), // "Name <email@domain>"

  // tenant branding
  brand_logo_url: BrandLogoUrl.optional(),
  brand_logo_variant: BrandLogoVariant, // "auto" | "light" | "dark" (optional)

  // enterprise/oauth
  email_send_mode: z.enum(["standard", "enterprise"]).optional(),
  email_identity_id: z.string().uuid().nullable().optional(),
});

function firstRow(r: any): any | null {
  // Drizzle execute can be array-like; avoid `.rows` assumptions
  try {
    if (!r) return null;
    if (Array.isArray((r as any)?.rows)) return (r as any).rows[0] ?? null;
    if (Array.isArray(r)) return r[0] ?? null;
    if (typeof r === "object" && r !== null && 0 in r) return (r as any)[0] ?? null;
    return null;
  } catch {
    return null;
  }
}

async function getTenantSettingsRow(tenantId: string) {
  const r = await db.execute(sql`
    select
      tenant_id,
      business_name,
      lead_to_email,
      resend_from_email,
      brand_logo_url,
      brand_logo_variant,
      email_send_mode,
      email_identity_id
    from tenant_settings
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);

  const row = firstRow(r);
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

  // Same semantics for logo variant
  const brandLogoVariant =
    "brand_logo_variant" in data && data.brand_logo_variant
      ? String(data.brand_logo_variant).trim().toLowerCase()
      : ("brand_logo_variant" in data ? null : undefined);

  // If provided but empty/invalid (shouldn't happen because zod enum), fall back
  const normalizedVariant =
    brandLogoVariant === undefined
      ? undefined
      : brandLogoVariant === null
      ? null
      : brandLogoVariant === "light" || brandLogoVariant === "dark" || brandLogoVariant === "auto"
      ? (brandLogoVariant as "auto" | "light" | "dark")
      : "auto";

  // 1) Try update first
  const upd = await db.execute(sql`
    update tenant_settings
    set
      business_name = ${data.business_name},
      lead_to_email = ${data.lead_to_email},
      resend_from_email = ${data.resend_from_email},

      brand_logo_url = ${brandLogoUrl === undefined ? sql`brand_logo_url` : brandLogoUrl},

      brand_logo_variant = ${
        normalizedVariant === undefined ? sql`brand_logo_variant` : normalizedVariant ?? "auto"
      },

      email_send_mode = ${emailSendMode},
      email_identity_id = ${emailIdentityId === undefined ? sql`email_identity_id` : emailIdentityId},

      updated_at = now()
    where tenant_id = ${tenantId}::uuid
    returning tenant_id
  `);

  const updatedRow = firstRow(upd);
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
        brand_logo_variant,
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
        ${(() => {
          // if not provided, default 'auto'
          if (!("brand_logo_variant" in data)) return "auto";
          const v = String((data as any).brand_logo_variant ?? "").trim().toLowerCase();
          return v === "light" || v === "dark" || v === "auto" ? v : "auto";
        })()},
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
      brand_logo_variant: settings?.brand_logo_variant ?? "auto",

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
        brand_logo_variant: saved?.brand_logo_variant ?? "auto",

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