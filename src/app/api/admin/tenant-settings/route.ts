import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import crypto from "crypto";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

const PostBody = z.object({
  tenantSlug: z.string().min(3),
  business_name: z.string().trim().min(1).max(120),
  lead_to_email: z.string().trim().email().max(200),
  resend_from_email: z.string().trim().min(5).max(200), // expects "Name <email@domain>"
});

async function getTenantIdFromSlug(tenantSlug: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug)).limit(1);
  const t: any = rows[0] ?? null;
  return t?.id ?? null;
}

async function getTenantSettingsRow(tenantId: string) {
  // Use raw SQL so we don't depend on Drizzle column names beyond tenants table
  const r = await db.execute(sql`
    select tenant_id, business_name, lead_to_email, resend_from_email
    from tenant_settings
    where tenant_id = ${tenantId}
    limit 1
  `);
  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  return row ?? null;
}

async function upsertTenantEmailSettings(tenantId: string, data: z.infer<typeof PostBody>) {
  // 1) try update existing
  const upd = await db.execute(sql`
    update tenant_settings
    set
      business_name = ${data.business_name},
      lead_to_email = ${data.lead_to_email},
      resend_from_email = ${data.resend_from_email}
    where tenant_id = ${tenantId}
    returning tenant_id
  `);

  const updatedRow: any =
    (upd as any)?.rows?.[0] ?? (Array.isArray(upd) ? (upd as any)[0] : null);

  if (updatedRow?.tenant_id) {
    return await getTenantSettingsRow(tenantId);
  }

  // 2) no row existed -> insert.
  // NOTE: tenant_settings may have additional NOT NULL fields in your schema.
  // We set industry_key to 'auto' as a safe default if it exists & is NOT NULL.
  // If your schema differs, the returned error will tell us exactly what column is missing.
  const newId = crypto.randomUUID();

  await db.execute(sql`
    insert into tenant_settings
      (id, tenant_id, industry_key, business_name, lead_to_email, resend_from_email, created_at)
    values
      (${newId}::uuid, ${tenantId}, 'auto', ${data.business_name}, ${data.lead_to_email}, ${data.resend_from_email}, now())
  `);

  return await getTenantSettingsRow(tenantId);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenantSlug = (url.searchParams.get("tenantSlug") ?? "").trim();

  if (!tenantSlug) {
    return json({ ok: false, error: "MISSING_TENANT_SLUG" }, 400);
  }

  const tenantId = await getTenantIdFromSlug(tenantSlug);
  if (!tenantId) {
    return json({ ok: false, error: "TENANT_NOT_FOUND", tenantSlug }, 404);
  }

  const settings = await getTenantSettingsRow(tenantId);

  return json({
    ok: true,
    tenantSlug,
    tenantId,
    settings: {
      business_name: settings?.business_name ?? "",
      lead_to_email: settings?.lead_to_email ?? "",
      resend_from_email: settings?.resend_from_email ?? "",
    },
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = PostBody.safeParse(body);

  if (!parsed.success) {
    return json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, 400);
  }

  const tenantId = await getTenantIdFromSlug(parsed.data.tenantSlug);
  if (!tenantId) {
    return json({ ok: false, error: "TENANT_NOT_FOUND", tenantSlug: parsed.data.tenantSlug }, 404);
  }

  try {
    const saved = await upsertTenantEmailSettings(tenantId, parsed.data);
    return json({
      ok: true,
      tenantSlug: parsed.data.tenantSlug,
      tenantId,
      settings: {
        business_name: saved?.business_name ?? "",
        lead_to_email: saved?.lead_to_email ?? "",
        resend_from_email: saved?.resend_from_email ?? "",
      },
    });
  } catch (e: any) {
    // bubble up real DB error so we can adjust insert fields if your tenant_settings schema differs
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
