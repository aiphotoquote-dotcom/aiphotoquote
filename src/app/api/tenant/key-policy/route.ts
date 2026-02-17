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

type PlanTier = "tier0" | "tier1" | "tier2" | "tier3" | "tier4" | string;

function isTier0(tier: unknown): boolean {
  return safeTrim(tier) === "tier0";
}
function isTier1or2(tier: unknown): boolean {
  const t = safeTrim(tier);
  return t === "tier1" || t === "tier2";
}
function hasGraceRemaining(credits: unknown, used: unknown): boolean {
  const c = Number(credits ?? 0);
  const u = Number(used ?? 0);
  if (!Number.isFinite(c) || !Number.isFinite(u)) return false;
  return c > 0 && u < c;
}

function platformKeyPresent(): boolean {
  const k = safeTrim(process.env.OPENAI_API_KEY);
  return Boolean(k);
}

export async function GET(req: Request) {
  try {
    await requireTenantRole(["owner", "admin"]);

    const url = new URL(req.url);
    const parsed = Query.safeParse({
      tenantId: url.searchParams.get("tenantId") || "",
    });

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "BAD_REQUEST", message: "Invalid query params", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { tenantId } = parsed.data;

    const settings = await db
      .select({
        tenantId: tenantSettings.tenantId,
        planTier: tenantSettings.planTier,
        activationGraceCredits: tenantSettings.activationGraceCredits,
        activationGraceUsed: tenantSettings.activationGraceUsed,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!settings) {
      return NextResponse.json(
        { ok: false, error: "SETTINGS_MISSING", message: "Tenant settings not found." },
        { status: 404 }
      );
    }

    const secretRow = await db
      .select({ openaiKeyEnc: tenantSecrets.openaiKeyEnc })
      .from(tenantSecrets)
      .where(eq(tenantSecrets.tenantId, tenantId))
      .limit(1)
      .then((r) => r[0] ?? null);

    const planTier: PlanTier = (settings as any)?.planTier ?? "tier0";
    const graceRemaining = hasGraceRemaining(settings.activationGraceCredits, settings.activationGraceUsed);

    // Policy: platform key allowed for tier0 always; for tier1/2 only while grace remains.
    const platformAllowed =
      isTier0(planTier) || (isTier1or2(planTier) && graceRemaining);

    return NextResponse.json({
      ok: true,
      tenantId,
      keyPolicy: {
        planTier,
        hasTenantKey: Boolean(secretRow?.openaiKeyEnc),
        platformKeyPresent: platformKeyPresent(),
        platformAllowed,
        graceRemaining,
        activationGraceCredits: Number(settings.activationGraceCredits ?? 0),
        activationGraceUsed: Number(settings.activationGraceUsed ?? 0),
      },
    });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const code = msg === "NO_ACTIVE_TENANT" ? 401 : 500;
    return NextResponse.json({ ok: false, error: "REQUEST_FAILED", message: msg }, { status: code });
  }
}