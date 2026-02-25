// src/lib/llm/openaiClient.ts

import OpenAI from "openai";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenantSecrets, tenantSettings } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";
import type { DebugFn, KeySource } from "./types";

function platformOpenAiKey(): string | null {
  const k = process.env.OPENAI_API_KEY?.trim() || "";
  return k ? k : null;
}

function asNonEmptyString(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function err(code: string, message?: string, status?: number, meta?: any) {
  const e: any = new Error(message || code);
  e.code = code;
  if (status) e.status = status;
  if (meta !== undefined) e.meta = meta;
  return e;
}

/**
 * Resolve OpenAI client (tenant key OR platform grace)
 * - Phase1: consumeGrace=true (counts against activationGraceCredits if tenant key missing)
 * - Phase2: consumeGrace=false AND forceKeySource must match snapshot (if present)
 */
export async function resolveOpenAiClient(args: {
  tenantId: string;
  consumeGrace: boolean;
  forceKeySource?: KeySource | null;
  debug?: DebugFn;
}): Promise<{ openai: OpenAI; keySource: KeySource }> {
  const { tenantId, consumeGrace, forceKeySource, debug } = args;

  debug?.("llm.resolveOpenAiClient.start", {
    tenantId,
    consumeGrace,
    forceKeySource: forceKeySource ?? null,
  });

  // 1) Tenant key (unless forced platform)
  if (!forceKeySource || forceKeySource === "tenant") {
    const secretRow = await db
      .select({ openaiKeyEnc: tenantSecrets.openaiKeyEnc })
      .from(tenantSecrets)
      .where(eq(tenantSecrets.tenantId, tenantId))
      .limit(1)
      .then((r) => r[0] ?? null);

    debug?.("llm.resolveOpenAiClient.tenantSecret.lookup", {
      hasTenantSecret: Boolean(secretRow?.openaiKeyEnc),
    });

    const enc = asNonEmptyString(secretRow?.openaiKeyEnc);

    if (enc) {
      const decrypted = decryptSecret(enc);
      const openaiKey = asNonEmptyString(decrypted);

      if (!openaiKey) {
        debug?.("llm.resolveOpenAiClient.tenantSecret.decryptFailed", {
          hasTenantSecret: true,
        });
        throw err("TENANT_KEY_DECRYPT_FAILED", "Unable to decrypt tenant OpenAI key.", 500);
      }

      debug?.("llm.resolveOpenAiClient.tenantSecret.use", { keySource: "tenant" });
      return { openai: new OpenAI({ apiKey: openaiKey }), keySource: "tenant" };
    }

    if (forceKeySource === "tenant") {
      throw err("MISSING_OPENAI_KEY", "Missing tenant OpenAI key.", 402);
    }
  }

  // 2) Platform grace key
  const platformKey = platformOpenAiKey();
  debug?.("llm.resolveOpenAiClient.platformKey.present", { hasPlatformKey: Boolean(platformKey) });

  if (!platformKey) {
    throw err("MISSING_PLATFORM_OPENAI_KEY", "Missing platform OpenAI key (OPENAI_API_KEY).", 500);
  }

  // Phase 2 finalize: do NOT consume; honor phase1 snapshot decision
  if (!consumeGrace) {
    debug?.("llm.resolveOpenAiClient.platformGrace.noConsume", { keySource: "platform_grace" });
    return { openai: new OpenAI({ apiKey: platformKey }), keySource: "platform_grace" };
  }

  const updated = await db
    .update(tenantSettings)
    .set({
      activationGraceUsed: sql`coalesce(${tenantSettings.activationGraceUsed}, 0) + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tenantSettings.tenantId, tenantId),
        sql`coalesce(${tenantSettings.activationGraceUsed}, 0) < coalesce(${tenantSettings.activationGraceCredits}, 0)`
      )
    )
    .returning({
      activation_grace_used: sql`coalesce(${tenantSettings.activationGraceUsed}, 0)`,
      activation_grace_credits: sql`coalesce(${tenantSettings.activationGraceCredits}, 0)`,
    });

  const row = updated?.[0] ?? null;

  debug?.("llm.resolveOpenAiClient.grace.updateResult", {
    updatedRowReturned: Boolean(row),
    activation_grace_used: row?.activation_grace_used ?? null,
    activation_grace_credits: row?.activation_grace_credits ?? null,
  });

  if (!row) {
    const cur = await db
      .select({
        used: sql`coalesce(${tenantSettings.activationGraceUsed}, 0)`,
        credits: sql`coalesce(${tenantSettings.activationGraceCredits}, 0)`,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId))
      .limit(1);

    const curRow = cur?.[0] ?? null;

    debug?.("llm.resolveOpenAiClient.grace.current", {
      hasRow: Boolean(curRow),
      used: curRow?.used ?? null,
      credits: curRow?.credits ?? null,
    });

    if (!curRow) {
      throw err("SETTINGS_MISSING", "Tenant settings missing.", 400);
    }

    const used = Number(curRow.used ?? 0);
    const credits = Number(curRow.credits ?? 0);

    throw err("TRIAL_EXHAUSTED", "Activation grace exhausted.", 402, { used, credits });
  }

  debug?.("llm.resolveOpenAiClient.platformGrace.consumeOk", { keySource: "platform_grace" });
  return { openai: new OpenAI({ apiKey: platformKey }), keySource: "platform_grace" };
}