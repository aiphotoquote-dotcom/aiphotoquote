// src/app/api/tenant/key-policy/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { requireTenantRole } from "@/lib/auth/tenant";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  tenantId: z.string().uuid(),
});

function safeTrimLower(v: unknown) {
  const s = String(v ?? "").trim().toLowerCase();
  return s ? s : "";
}

function hasGraceRemaining(credits: unknown, used: unknown): boolean {
  const c = Number(credits ?? 0);
  const u = Number(used ?? 0);
  if (!Number.isFinite(c) || !Number.isFinite(u)) return false;
  return c > 0 && u < c;
}

function isTier0(tier: string) {
  return tier === "tier0";
}
function isTier1or2(tier: string) {
  return tier === "tier1" || tier === "tier2";
}

/**
 * ✅ Robust platform key detection.
 * We accept multiple env names so Preview/Prod naming mismatches don't silently break key policy.
 */
function detectPlatformKey(): { hasPlatformKey: boolean; envName: string | null } {
  const candidates = [
    "OPENAI_API_KEY", // your stated canonical
    "OPENAI_PLATFORM_API_KEY", // fallback (if you ever renamed)
    "OPENAI_KEY", // fallback
  ] as const;

  for (const name of candidates) {
    const v = String(process.env[name] ?? "").trim();
    if (v) return { hasPlatformKey: true, envName: name };
  }
  return { hasPlatformKey: false, envName: null };
}

export async function GET(req: Request) {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error, message: gate.message }, { status: gate.status });
  }

  const url = new URL(req.url);
  const parsed = Query.safeParse({ tenantId: url.searchParams.get("tenantId") || "" });
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "BAD_REQUEST", message: "Invalid query params", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  // ✅ prevent probing other tenants
  if (parsed.data.tenantId !== gate.tenantId) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN", message: "Tenant mismatch." }, { status: 403 });
  }

  const tenantId = parsed.data.tenantId;

  // ✅ Plan tier: tenants.plan_tier (source of truth)
  // Grace counters: tenant_settings
  // Tenant key presence: tenant_secrets.openai_key_enc
  const r = await db.execute(sql`
    select
      t.plan_tier as plan_tier,
      ts.activation_grace_credits as activation_grace_credits,
      ts.activation_grace_used as activation_grace_used,
      sec.openai_key_enc as openai_key_enc
    from tenants t
    left join tenant_settings ts on ts.tenant_id = t.id
    left join tenant_secrets sec on sec.tenant_id = t.id
    where t.id = ${tenantId}::uuid
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  if (!row) {
    return NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND", message: "Tenant not found." }, { status: 404 });
  }

  const planTier = safeTrimLower(row.plan_tier) || "tier0";

  const activationGraceCredits = Number(row.activation_grace_credits ?? 0) || 0;
  const activationGraceUsed = Number(row.activation_grace_used ?? 0) || 0;

  const hasTenantOpenAiKey = Boolean(row.openai_key_enc);

  const graceRemaining = hasGraceRemaining(activationGraceCredits, activationGraceUsed);

  // Policy:
  // - tier0: platform allowed always
  // - tier1/2: platform allowed only while grace remains
  const platformAllowed = isTier0(planTier) || (isTier1or2(planTier) && graceRemaining);

  const { hasPlatformKey, envName: platformKeyEnvName } = detectPlatformKey();

  const effectiveKeySourceNow: "tenant" | "platform_grace" | "none" = hasTenantOpenAiKey
    ? "tenant"
    : platformAllowed && hasPlatformKey
      ? "platform_grace"
      : "none";

  const wouldConsumeGraceOnNewQuote =
    effectiveKeySourceNow === "platform_grace" && isTier1or2(planTier); // tier0 never consumes

  // ✅ Reason text that matches the computed state (no contradictions)
  let reason: string | null = null;

  if (effectiveKeySourceNow === "tenant") {
    reason = "Tenant key is set.";
  } else if (!hasPlatformKey) {
    reason =
      "Platform OpenAI key is not configured in this deployment environment (Vercel Preview/Prod env vars may differ).";
  } else if (!platformAllowed) {
    reason = "Platform key is configured but not allowed for this plan tier.";
  } else if (wouldConsumeGraceOnNewQuote) {
    reason = "Currently using platform key under grace. New quotes will consume a grace credit until grace runs out.";
  } else {
    reason = "Currently using platform key. This request type will not consume grace.";
  }

  return NextResponse.json({
    ok: true,
    tenantId,

    planTier,
    activationGraceCredits,
    activationGraceUsed,
    hasTenantOpenAiKey,

    // ✅ platform key visibility
    hasPlatformKey,
    platformKeyEnvName, // helpful for debugging (non-secret)
    platformAllowed,
    graceRemaining,

    effectiveKeySourceNow,
    wouldConsumeGraceOnNewQuote,
    reason,
  });
}