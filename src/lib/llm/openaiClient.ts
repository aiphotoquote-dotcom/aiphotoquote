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

    if (secretRow?.openaiKeyEnc) {
      const openaiKey = decryptSecret(secretRow.openaiKeyEnc);
      debug?.("llm.resolveOpenAiClient.tenantSecret.use", { keySource: "tenant" });
      return { openai: new OpenAI({ apiKey: openaiKey }), keySource: "tenant" };
    }

    if (forceKeySource === "tenant") {
      const e: any = new Error("MISSING_OPENAI_KEY");
      e.code = "MISSING_OPENAI_KEY";
      throw e;
    }
  }

  // 2) Platform grace key
  const platformKey = platformOpenAiKey();
  debug?.("llm.resolveOpenAiClient.platformKey.present", { hasPlatformKey: Boolean(platformKey) });

  if (!platformKey) {
    const e: any = new Error("MISSING_PLATFORM_OPENAI_KEY");
    e.code = "MISSING_PLATFORM_OPENAI_KEY";
    throw e;
  }

  // Phase 2 finalize: do NOT consume; honor phase1
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
      const e: any = new Error("SETTINGS_MISSING");
      e.code = "SETTINGS_MISSING";
      e.status = 400;
      throw e;
    }

    const used = Number(curRow.used ?? 0);
    const credits = Number(curRow.credits ?? 0);

    const e: any = new Error("TRIAL_EXHAUSTED");
    e.code = "TRIAL_EXHAUSTED";
    e.status = 402;
    e.meta = { used, credits };
    throw e;
  }

  debug?.("llm.resolveOpenAiClient.platformGrace.consumeOk", { keySource: "platform_grace" });
  return { openai: new OpenAI({ apiKey: platformKey }), keySource: "platform_grace" };
}