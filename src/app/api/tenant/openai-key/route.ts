// src/app/api/tenant/openai-key/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { requireTenantRole } from "@/lib/auth/tenant";
import { db } from "@/lib/db/client";
import { encryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

const PostBody = z.object({
  tenantId: z.string().uuid(),
  openaiApiKey: z.string().min(8).max(512),
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

  // ✅ do not allow writing other tenants
  if (parsed.data.tenantId !== gate.tenantId) {
    return json({ ok: false, error: "FORBIDDEN", message: "Tenant mismatch." }, 403);
  }

  const keyRaw = safeTrim(parsed.data.openaiApiKey);

  // Light validation (don’t be too opinionated; different key formats exist)
  if (keyRaw.length < 8) {
    return json({ ok: false, error: "BAD_REQUEST", message: "Key looks too short." }, 400);
  }

  try {
    const enc = encryptSecret(keyRaw);
    if (!enc) {
      return json({ ok: false, error: "ENCRYPT_FAILED", message: "Unable to encrypt key." }, 500);
    }

    // ✅ Upsert into tenant_secrets
    // Assumes tenant_secrets row may or may not exist.
    await db.execute(sql`
      insert into tenant_secrets (tenant_id, openai_key_enc, created_at, updated_at)
      values (${gate.tenantId}::uuid, ${enc}, now(), now())
      on conflict (tenant_id)
      do update set
        openai_key_enc = excluded.openai_key_enc,
        updated_at = now()
    `);

    return json({ ok: true, tenantId: gate.tenantId, hasTenantOpenAiKey: true }, 200);
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

export async function DELETE(req: Request) {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) return json({ ok: false, error: gate.error, message: gate.message }, gate.status);

  const body = await req.json().catch(() => null);
  const parsed = DeleteBody.safeParse(body);
  if (!parsed.success) return json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, 400);

  // ✅ do not allow writing other tenants
  if (parsed.data.tenantId !== gate.tenantId) {
    return json({ ok: false, error: "FORBIDDEN", message: "Tenant mismatch." }, 403);
  }

  try {
    // Clear the encrypted key; keep the row.
    await db.execute(sql`
      update tenant_secrets
      set openai_key_enc = null, updated_at = now()
      where tenant_id = ${gate.tenantId}::uuid
    `);

    return json({ ok: true, tenantId: gate.tenantId, hasTenantOpenAiKey: false }, 200);
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