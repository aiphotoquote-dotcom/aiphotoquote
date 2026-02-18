// src/app/api/tenant/openai-key/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";

import { requireTenantRole } from "@/lib/auth/tenant";
import { db } from "@/lib/db/client";
import { tenantSecrets } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

// NOTE: This route stores an *encrypted* value in tenant_secrets.openai_key_enc.
// In your repo you already treat it as encrypted, so we do not attempt to "validate"
// the key against OpenAI here — just store it.
// If you later want real encryption-at-rest beyond "opaque storage", wire your
// encryption helper here and keep column name openai_key_enc.
function normalizeKey(raw: string) {
  return safeTrim(raw);
}

function last4(key: string) {
  const k = safeTrim(key);
  return k.length >= 4 ? k.slice(-4) : k;
}

const PostBody = z.object({
  tenantId: z.string().uuid(),
  openaiApiKey: z.string().min(10),
});

const DeleteBody = z.object({
  tenantId: z.string().uuid(),
});

export async function POST(req: Request) {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) return json({ ok: false, error: gate.error, message: gate.message }, gate.status);

  const body = await req.json().catch(() => null);
  const parsed = PostBody.safeParse(body);
  if (!parsed.success) return json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, 400);

  if (parsed.data.tenantId !== gate.tenantId) {
    return json({ ok: false, error: "FORBIDDEN", message: "Tenant mismatch." }, 403);
  }

  const tenantId = parsed.data.tenantId;
  const key = normalizeKey(parsed.data.openaiApiKey);

  if (!key) return json({ ok: false, error: "BAD_REQUEST", message: "Key is empty." }, 400);

  try {
    // ✅ IMPORTANT: your table has NO created_at column.
    // Columns: tenant_id (PK), openai_key_enc, openai_key_last4, updated_at
    await db.execute(sql`
      insert into tenant_secrets (tenant_id, openai_key_enc, openai_key_last4, updated_at)
      values (${tenantId}::uuid, ${key}, ${last4(key)}, now())
      on conflict (tenant_id) do update
      set
        openai_key_enc = excluded.openai_key_enc,
        openai_key_last4 = excluded.openai_key_last4,
        updated_at = now()
    `);

    // Quick confirm read (optional)
    const row = await db
      .select({
        tenantId: tenantSecrets.tenantId,
        openaiKeyLast4: tenantSecrets.openaiKeyLast4,
        updatedAt: tenantSecrets.updatedAt,
      })
      .from(tenantSecrets)
      .where(eq(tenantSecrets.tenantId, tenantId))
      .limit(1)
      .then((r) => r[0] ?? null);

    return json({
      ok: true,
      tenantId,
      saved: true,
      openaiKeyLast4: row?.openaiKeyLast4 ?? last4(key),
      updatedAt: row?.updatedAt ?? new Date().toISOString(),
    });
  } catch (e: any) {
    return json({ ok: false, error: "SAVE_FAILED", message: e?.message ?? String(e) }, 500);
  }
}

export async function DELETE(req: Request) {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) return json({ ok: false, error: gate.error, message: gate.message }, gate.status);

  const body = await req.json().catch(() => null);
  const parsed = DeleteBody.safeParse(body);
  if (!parsed.success) return json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, 400);

  if (parsed.data.tenantId !== gate.tenantId) {
    return json({ ok: false, error: "FORBIDDEN", message: "Tenant mismatch." }, 403);
  }

  const tenantId = parsed.data.tenantId;

  try {
    // Either delete row or blank it out. I prefer delete.
    await db.execute(sql`
      delete from tenant_secrets
      where tenant_id = ${tenantId}::uuid
    `);

    return json({ ok: true, tenantId, cleared: true });
  } catch (e: any) {
    return json({ ok: false, error: "CLEAR_FAILED", message: e?.message ?? String(e) }, 500);
  }
}