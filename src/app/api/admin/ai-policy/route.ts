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

const AiMode = z.enum(["assessment_only", "range", "fixed"]);

const PostBody = z.object({
  ai_mode: AiMode,
  pricing_enabled: z.boolean(),
});

async function getRow(tenantId: string) {
  const r = await db.execute(sql`
    select ai_mode, pricing_enabled
    from tenant_settings
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);
  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  return row ?? null;
}

export async function GET() {
  const gate = await requireTenantRole(["owner", "admin", "member"]);
  if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status);

  const row = await getRow(gate.tenantId);

  const ai_mode = (row?.ai_mode ?? "assessment_only").toString();
  const pricing_enabled = row?.pricing_enabled ?? false;

  return json({
    ok: true,
    tenantId: gate.tenantId,
    role: gate.role,
    ai_policy: {
      ai_mode,
      pricing_enabled: !!pricing_enabled,
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
    const upd = await db.execute(sql`
      update tenant_settings
      set ai_mode = ${parsed.data.ai_mode},
          pricing_enabled = ${parsed.data.pricing_enabled},
          updated_at = now()
      where tenant_id = ${gate.tenantId}::uuid
      returning tenant_id
    `);

    const updatedRow: any =
      (upd as any)?.rows?.[0] ?? (Array.isArray(upd) ? (upd as any)[0] : null);

    if (!updatedRow?.tenant_id) {
      // If tenant_settings row doesn't exist yet for some tenant, create a minimal one.
      // industry_key default is arbitrary here; your onboarding flow can later set it.
      await db.execute(sql`
        insert into tenant_settings
          (id, tenant_id, industry_key, ai_mode, pricing_enabled, created_at)
        values
          (gen_random_uuid(), ${gate.tenantId}::uuid, 'auto', ${parsed.data.ai_mode}, ${parsed.data.pricing_enabled}, now())
      `);
    }

    const row = await getRow(gate.tenantId);

    return json({
      ok: true,
      tenantId: gate.tenantId,
      role: gate.role,
      ai_policy: {
        ai_mode: (row?.ai_mode ?? parsed.data.ai_mode).toString(),
        pricing_enabled: !!(row?.pricing_enabled ?? parsed.data.pricing_enabled),
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
