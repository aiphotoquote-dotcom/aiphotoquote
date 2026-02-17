// src/app/api/tenant/key-policy/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { requireTenantRole } from "@/lib/auth/tenant";
import { db } from "@/lib/db/client";
import { tenantSecrets, tenantSettings } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  tenantId: z.string().uuid(),
});

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function platformKeyPresent(): boolean {
  return Boolean(safeTrim(process.env.OPENAI_API_KEY));
}

function isTier0(tier: unknown): boolean {
  return safeTrim(tier).toLowerCase() === "tier0";
}

function hasGraceRemaining(credits: unknown, used: unknown): boolean {
  const c = Number(credits ?? 0);
  const u = Number(used ?? 0);
  if (!Number.isFinite(c) || !Number.isFinite(u)) return false;
  return c > 0 && u < c;
}

export async function GET(req: Request) {
  try {
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

    // ✅ Do NOT trust caller tenantId (must match active tenant context)
    if (parsed.data.tenantId !== gate.tenantId) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN", message: "Tenant mismatch." }, { status: 403 });
    }

    const settings = await db
      .select({
        tenantId: tenantSettings.tenantId,
        planTier: tenantSettings.planTier,
        activationGraceCredits: tenantSettings.activationGraceCredits,
        activationGraceUsed: tenantSettings.activationGraceUsed,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, gate.tenantId))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!settings) {
      return NextResponse.json({ ok: false, error: "SETTINGS_MISSING", message: "Tenant settings not found." }, { status: 404 });
    }

    const secretRow = await db
      .select({ openaiKeyEnc: tenantSecrets.openaiKeyEnc })
      .from(tenantSecrets)
      .where(eq(tenantSecrets.tenantId, gate.tenantId))
      .limit(1)
      .then((r) => r[0] ?? null);

    const planTier = safeTrim((settings as any)?.planTier) || null;

    const activationGraceCredits = Number(settings.activationGraceCredits ?? 0);
    const activationGraceUsed = Number(settings.activationGraceUsed ?? 0);
    const graceRemaining = hasGraceRemaining(activationGraceCredits, activationGraceUsed);

    const hasTenantOpenAiKey = Boolean(secretRow?.openaiKeyEnc);
    const hasPlatformKey = platformKeyPresent();

    // ✅ UI message is specifically "tier0 / grace" for platform key usage
    // Policy here: allow platform key for tier0 always. (You can extend later.)
    const platformAllowed = isTier0(planTier) && hasPlatformKey;

    const effectiveKeySourceNow: "tenant" | "platform_grace" =
      hasTenantOpenAiKey ? "tenant" : platformAllowed ? "platform_grace" : "platform_grace";

    const wouldConsumeGraceOnNewQuote = false; // your UI copy says it won't consume for this request type

    let reason: string | null = null;
    if (hasTenantOpenAiKey) {
      reason = "Tenant OpenAI key is present.";
    } else if (!hasPlatformKey) {
      reason = "No tenant key present and no platform key configured (OPENAI_API_KEY).";
    } else if (!platformAllowed) {
      reason = "Platform key is configured but not allowed for this plan tier.";
    } else if (graceRemaining) {
      reason = "Platform key allowed (tier0 / grace).";
    } else {
      reason = "Platform key allowed (tier0).";
    }

    // ✅ IMPORTANT: return the exact shape TenantLlmManagerClient expects
    return NextResponse.json({
      ok: true,
      tenantId: gate.tenantId,

      planTier,
      activationGraceCredits,
      activationGraceUsed,

      hasTenantOpenAiKey,
      effectiveKeySourceNow,
      wouldConsumeGraceOnNewQuote,

      reason,
    });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const code = msg === "NO_ACTIVE_TENANT" ? 401 : 500;
    return NextResponse.json({ ok: false, error: "REQUEST_FAILED", message: msg }, { status: code });
  }
}