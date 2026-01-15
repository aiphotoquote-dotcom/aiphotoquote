import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requireTenantRole } from "@/lib/auth/tenant";
import { encryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

const PostBody = z.object({
  openai_api_key: z.string().trim().min(20).max(300),
});

export async function GET() {
  const gate = await requireTenantRole(["owner", "admin", "member"]);
  if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status);

  const r = await db.execute(sql`
    select openai_key_last4, updated_at
    from tenant_secrets
    where tenant_id = ${gate.tenantId}::uuid
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

  return json({
    ok: true,
    tenantId: gate.tenantId,
    role: gate.role,
    configured: !!row?.openai_key_last4,
    openai_key_last4: row?.openai_key_last4 ?? null,
    updated_at: row?.updated_at ?? null,
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

  const rawKey = parsed.data.openai_api_key.trim();

  // Basic sanity check (don’t over-enforce patterns in case OpenAI changes formats)
  if (rawKey.length < 20) {
    return json({ ok: false, error: "INVALID_KEY", message: "Key looks too short." }, 400);
  }

  const enc = encryptSecret(rawKey);
  const last4 = rawKey.slice(-4);

  try {
    // tenant_secrets has PK on tenant_id (per your schema)
    await db.execute(sql`
      insert into tenant_secrets (tenant_id, openai_key_enc, openai_key_last4, updated_at)
      values (${gate.tenantId}::uuid, ${enc}, ${last4}, now())
      on conflict (tenant_id)
      do update set
        openai_key_enc = excluded.openai_key_enc,
        openai_key_last4 = excluded.openai_key_last4,
        updated_at = now()
    `);

    return json({
      ok: true,
      tenantId: gate.tenantId,
      configured: true,
      openai_key_last4: last4,
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
