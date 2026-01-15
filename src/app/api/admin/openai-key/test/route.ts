import { NextResponse } from "next/server";
import OpenAI from "openai";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requireTenantRole } from "@/lib/auth/tenant";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

export async function POST() {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status);

  const r = await db.execute(sql`
    select openai_key_enc, openai_key_last4, updated_at
    from tenant_secrets
    where tenant_id = ${gate.tenantId}::uuid
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

  if (!row?.openai_key_enc) {
    return json({ ok: false, error: "OPENAI_KEY_MISSING", message: "Tenant OpenAI key not set." }, 400);
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(row.openai_key_enc);
  } catch (e: any) {
    return json(
      { ok: false, error: "OPENAI_KEY_DECRYPT_FAILED", message: e?.message ?? String(e) },
      500
    );
  }

  try {
    const client = new OpenAI({ apiKey });

    // Lightweight test call (fast + low cost)
    const resp = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [{ role: "user", content: [{ type: "input_text", text: "Return the single word: OK" }] }],
      max_output_tokens: 10,
    });

    // If it succeeded, we’re good.
    return json({
      ok: true,
      tenantId: gate.tenantId,
      openai_key_last4: row.openai_key_last4 ?? null,
      updated_at: row.updated_at ?? null,
      responseId: (resp as any).id ?? null,
      note: "OpenAI key test succeeded.",
    });
  } catch (e: any) {
    // Surface real OpenAI error info (no secrets)
    return json(
      {
        ok: false,
        error: "OPENAI_TEST_FAILED",
        message: e?.message ?? String(e),
        status: e?.status,
        code: e?.code,
        type: e?.type,
      },
      500
    );
  }
}
