// src/app/api/tenant/openai-key/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { requireTenantRole } from "@/lib/auth/tenant";
import { db } from "@/lib/db/client";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function normalizeKey(raw: string) {
  return safeTrim(raw);
}

function last4(key: string) {
  const k = safeTrim(key);
  return k.length >= 4 ? k.slice(-4) : k;
}

function looksLikeOpenAiKey(v: string) {
  const s = safeTrim(v);
  // OpenAI keys are typically sk-... or sk-proj-...
  return s.startsWith("sk-") || s.startsWith("sk-proj-");
}

/**
 * Accepts either:
 * - plaintext key => encrypt it
 * - already-encrypted blob => verify by decrypting; if it decrypts to sk-..., accept as encrypted
 */
function coerceEncryptedKey(input: string): { enc: string; decrypted: string } {
  const raw = normalizeKey(input);
  if (!raw) throw new Error("KEY_EMPTY");

  // Most common: plaintext pasted by tenant admin
  if (looksLikeOpenAiKey(raw)) {
    const enc = encryptSecret(raw);
    return { enc, decrypted: raw };
  }

  // Otherwise: treat as possibly already-encrypted
  // Validate by decrypting and ensuring it becomes a plausible OpenAI key.
  try {
    const dec = decryptSecret(raw);
    if (!looksLikeOpenAiKey(dec)) {
      throw new Error("DECRYPTED_NOT_OPENAI_KEY");
    }
    return { enc: raw, decrypted: dec };
  } catch {
    const e: any = new Error("INVALID_KEY_FORMAT");
    e.code = "INVALID_KEY_FORMAT";
    throw e;
  }
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

  try {
    const normalized = normalizeKey(parsed.data.openaiApiKey);
    if (!normalized) return json({ ok: false, error: "BAD_REQUEST", message: "Key is empty." }, 400);

    // ✅ ALWAYS store encrypted
    const { enc, decrypted } = coerceEncryptedKey(normalized);

    // ✅ IMPORTANT: your DB table columns:
    // tenant_id (PK), openai_key_enc, openai_key_last4, updated_at
    await db.execute(sql`
      insert into tenant_secrets (tenant_id, openai_key_enc, openai_key_last4, updated_at)
      values (${tenantId}::uuid, ${enc}, ${last4(decrypted)}, now())
      on conflict (tenant_id) do update
      set
        openai_key_enc = excluded.openai_key_enc,
        openai_key_last4 = excluded.openai_key_last4,
        updated_at = now()
    `);

    return json({
      ok: true,
      tenantId,
      saved: true,
      openaiKeyLast4: last4(decrypted),
      updatedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    const code = e?.code || e?.message || "SAVE_FAILED";

    if (code === "INVALID_KEY_FORMAT") {
      return json(
        {
          ok: false,
          error: "INVALID_KEY_FORMAT",
          message: "Key must be a valid OpenAI key (sk-...) or a valid encrypted secret.",
        },
        400
      );
    }

    if (code === "KEY_EMPTY") {
      return json({ ok: false, error: "BAD_REQUEST", message: "Key is empty." }, 400);
    }

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
    await db.execute(sql`
      delete from tenant_secrets
      where tenant_id = ${tenantId}::uuid
    `);

    return json({ ok: true, tenantId, cleared: true });
  } catch (e: any) {
    return json({ ok: false, error: "CLEAR_FAILED", message: e?.message ?? String(e) }, 500);
  }
}