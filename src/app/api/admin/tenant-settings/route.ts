import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import crypto from "crypto";

import { db } from "@/lib/db/client";
import { requireTenantRole } from "@/lib/auth/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

const PostBody = z.object({
  business_name: z.string().trim().min(1).max(120),
  lead_to_email: z.string().trim().email().max(200),
  resend_from_email: z.string().trim().min(5).max(200), // "Name <email@domain>"
});

async function getTenantSettingsRow(tenantId: string) {
  const r = await db.execute(sql`
    select tenant_id, business_name, lead_to_email, resend_from_email
    from tenant_settings
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);
  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  return row ?? null;
}

async function upsertTenantEmailSettings(tenantId: string, data: z.infer<typeof PostBody>) {
  const upd = await db.execute(sql`
    update tenant_settings
    set
      business_name = ${data.business_name},
      lead_to_email = ${data.lead_to_email},
      resend_from_email = ${data.resend_from_email}
    where tenant_id = ${tenantId}::uuid
    returning tenant_id
  `);

  const updatedRow: any =
    (upd as any)?.rows?.[0] ?? (Array.isArray(upd) ? (upd as any)[0] : null);

  if (updatedRow?.tenant_id) return await getTenantSettingsRow(tenantId);

  // Insert if missing
  const newId = crypto.randomUUID();
  await db.execute(sql`
    insert into tenant_settings
      (id, tenant_id, industry_key, business_name, lead_to_email, resend_from_email, created_at)
    values
      (${newId}::uuid, ${tenantId}::uuid, 'auto', ${data.business_name}, ${data.lead_to_email}, ${data.resend_from_email}, now())
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
