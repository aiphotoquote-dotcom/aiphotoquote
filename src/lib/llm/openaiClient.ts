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

function safeLower(v: unknown) {
  return String(v ?? "").trim().toLowerCase();
}

type GraceState = {
  hasRow: boolean;
  planTier: string | null;
  eligibleTier: boolean;
  used: number;
  credits: number;
  remaining: number;
  inGrace: boolean;
};

async function readGraceState(tenantId: string, debug?: DebugFn): Promise<GraceState> {
  const rows = await db
    .select({
      planTier: tenantSettings.planTier,
      // coalesce into numbers via sql so we don't care about nulls
      used: sql<number>`coalesce(${tenantSettings.activationGraceUsed}, 0)`,
      credits: sql<number>`coalesce(${tenantSettings.activationGraceCredits}, 0)`,
    })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId))
    .limit(1);

  const row = rows?.[0] ?? null;
  if (!row) {
    debug?.("llm.resolveOpenAiClient.grace.read", { hasRow: false });
    return {
      hasRow: false,
      planTier: null,
      eligibleTier: false,
      used: 0,
      credits: 0,
      remaining: 0,
      inGrace: false,
    };
  }

  const planTier = safeLower(row.planTier) || null;
  const used = Number(row.used ?? 0);
  const credits = Number(row.credits ?? 0);

  const eligibleTier = planTier === "tier0" || planTier === "tier1" || planTier === "tier2";
  const remaining = Math.max(0, (Number.isFinite(credits) ? credits : 0) - (Number.isFinite(used) ? used : 0));
  const inGrace = eligibleTier && remaining > 0;

  debug?.("llm.resolveOpenAiClient.grace.read", {
    hasRow: true,
    planTier,
    eligibleTier,
    used,
    credits,
    remaining,
    inGrace,
  });

  return { hasRow: true, planTier, eligibleTier, used, credits, remaining, inGrace };
}

function err(code: string, status?: number, meta?: any) {
  const e: any = new Error(code);
  e.code = code;
  if (status) e.status = status;
  if (meta) e.meta = meta;
  return e;
}

/**
 * Resolve OpenAI client (tenant key OR platform grace)
 *
 * Rules (authoritative):
 * - If tenant key exists -> ALWAYS use tenant key (even if forceKeySource says platform_grace)
 * - Platform key can ONLY be used when:
 *    - tenant key missing
 *    - plan_tier in (tier0,tier1,tier2)
 *    - activation_grace_credits - activation_grace_used > 0
 *    - platform OPENAI_API_KEY exists
 *
 * consumeGrace:
 * - true  => atomically consumes 1 grace credit (only if in grace)
 * - false => does NOT consume, but STILL requires in grace to use platform key
 *
 * forceKeySource:
 * - "tenant"         => require tenant key; if missing -> throw MISSING_OPENAI_KEY
 * - "platform_grace" => require platform grace eligibility; if not eligible/inGrace -> throw TRIAL_EXHAUSTED/PLAN_NOT_ELIGIBLE
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

  // 1) Look for tenant key first (tenant key ALWAYS wins)
  const secretRow = await db
    .select({ openaiKeyEnc: tenantSecrets.openaiKeyEnc })
    .from(tenantSecrets)
    .where(eq(tenantSecrets.tenantId, tenantId))
    .limit(1)
    .then((r) => r[0] ?? null);

  const hasTenantKey = Boolean(secretRow?.openaiKeyEnc);

  debug?.("llm.resolveOpenAiClient.tenantSecret.lookup", { hasTenantKey });

  if (hasTenantKey) {
    if (forceKeySource === "platform_grace") {
      debug?.("llm.resolveOpenAiClient.forceKeySource.overridden", {
        requested: "platform_grace",
        effective: "tenant",
        reason: "tenant_key_present",
      });
    }

    const openaiKey = decryptSecret(secretRow!.openaiKeyEnc);
    debug?.("llm.resolveOpenAiClient.tenantSecret.use", { keySource: "tenant" });
    return { openai: new OpenAI({ apiKey: openaiKey }), keySource: "tenant" };
  }

  // If caller requires tenant key, fail now.
  if (forceKeySource === "tenant") {
    throw err("MISSING_OPENAI_KEY", 402);
  }

  // 2) Platform key path — must be in grace (tier0/1/2 + remaining credits)
  const platformKey = platformOpenAiKey();
  debug?.("llm.resolveOpenAiClient.platformKey.present", { hasPlatformKey: Boolean(platformKey) });

  if (!platformKey) {
    throw err("MISSING_PLATFORM_OPENAI_KEY", 500);
  }

  // Always read grace state before allowing platform usage (even when consumeGrace=false)
  const grace = await readGraceState(tenantId, debug);
  if (!grace.hasRow) {
    throw err("SETTINGS_MISSING", 400);
  }

  if (!grace.eligibleTier) {
    // Not a grace tier -> platform is NOT allowed
    throw err("PLAN_NOT_ELIGIBLE_FOR_GRACE", 402, { planTier: grace.planTier });
  }

  if (!grace.inGrace) {
    // Eligible tier but no credits remaining -> deny platform usage
    throw err("TRIAL_EXHAUSTED", 402, { used: grace.used, credits: grace.credits, remaining: grace.remaining });
  }

  // Phase 2 finalize: do NOT consume; still requires in-grace (enforced above)
  if (!consumeGrace) {
    debug?.("llm.resolveOpenAiClient.platformGrace.noConsume", {
      keySource: "platform_grace",
      planTier: grace.planTier,
      remaining: grace.remaining,
    });
    return { openai: new OpenAI({ apiKey: platformKey }), keySource: "platform_grace" };
  }

  // consumeGrace=true => atomically consume one credit, only while still in-grace
  const updated = await db
    .update(tenantSettings)
    .set({
      activationGraceUsed: sql`coalesce(${tenantSettings.activationGraceUsed}, 0) + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tenantSettings.tenantId, tenantId),
        sql`lower(coalesce(${tenantSettings.planTier}, '')) in ('tier0','tier1','tier2')`,
        sql`coalesce(${tenantSettings.activationGraceUsed}, 0) < coalesce(${tenantSettings.activationGraceCredits}, 0)`
      )
    )
    .returning({
      activation_grace_used: sql`coalesce(${tenantSettings.activationGraceUsed}, 0)`,
      activation_grace_credits: sql`coalesce(${tenantSettings.activationGraceCredits}, 0)`,
      plan_tier: tenantSettings.planTier,
    });

  const row = updated?.[0] ?? null;

  debug?.("llm.resolveOpenAiClient.grace.consume.updateResult", {
    updatedRowReturned: Boolean(row),
    activation_grace_used: row?.activation_grace_used ?? null,
    activation_grace_credits: row?.activation_grace_credits ?? null,
    planTier: safeLower(row?.plan_tier ?? "") || null,
  });

  if (!row) {
    // Something changed between read and update — treat as exhausted/denied safely.
    const cur = await readGraceState(tenantId, debug);
    if (!cur.hasRow) throw err("SETTINGS_MISSING", 400);
    if (!cur.eligibleTier) throw err("PLAN_NOT_ELIGIBLE_FOR_GRACE", 402, { planTier: cur.planTier });
    throw err("TRIAL_EXHAUSTED", 402, { used: cur.used, credits: cur.credits, remaining: cur.remaining });
  }

  debug?.("llm.resolveOpenAiClient.platformGrace.consumeOk", {
    keySource: "platform_grace",
    planTier: safeLower(row.plan_tier) || null,
    used: row.activation_grace_used ?? null,
    credits: row.activation_grace_credits ?? null,
  });

  return { openai: new OpenAI({ apiKey: platformKey }), keySource: "platform_grace" };
}