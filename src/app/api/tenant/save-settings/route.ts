import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db/client";
import { tenants, tenantSettings } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Save tenant settings (industry, URLs, etc.)
 * Called from TenantOnboardingForm.
 *
 * IMPORTANT:
 * - Clerk auth() is async in this repo setup -> must await.
 * - Do NOT use db.query.* (db isn't typed with schema generics). Use select/from/where.
 */

const Body = z.object({
  tenantSlug: z.string().min(3),
  industryKey: z.string().min(1),

  // Optional URLs
  redirectUrl: z.string().optional().nullable(),
  thankYouUrl: z.string().optional().nullable(),

  // Optional pricing guardrails (if your form sends them)
  minJob: z.number().int().nonnegative().optional().nullable(),
  typicalLow: z.number().int().nonnegative().optional().nullable(),
  typicalHigh: z.number().int().nonnegative().optional().nullable(),
  maxWithoutInspection: z.number().int().nonnegative().optional().nullable(),
});

function normalizeUrl(u: string | null | undefined) {
  const s = String(u ?? "").trim();
  if (!s) return null;

  // allow "example.com" without scheme
  if (!/^https?:\/\//i.test(s)) return `https://${s}`;
  return s;
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }

    const json = await req.json().catch(() => null);
    const parsed = Body.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "INVALID_BODY", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { tenantSlug, industryKey, redirectUrl, thankYouUrl } = parsed.data;

    // Resolve tenant owned by this user (slug is unique)
    const tenantRows = await db
      .select({
        id: tenants.id,
        slug: tenants.slug,
        ownerClerkUserId: tenants.ownerClerkUserId,
      })
      .from(tenants)
      .where(and(eq(tenants.slug, tenantSlug), eq(tenants.ownerClerkUserId, userId)))
      .limit(1);

    const tenant = tenantRows[0] ?? null;
    if (!tenant) {
      return NextResponse.json(
        { ok: false, error: "TENANT_NOT_FOUND_OR_NOT_OWNED" },
        { status: 404 }
      );
    }

    const redirect = normalizeUrl(redirectUrl);
    const thankYou = normalizeUrl(thankYouUrl);

    // Upsert tenant_settings (tenant_id is PK in your DB)
    await db
      .insert(tenantSettings)
      .values({
        tenantId: tenant.id,
        industryKey,
        redirectUrl: redirect,
        thankYouUrl: thankYou,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: tenantSettings.tenantId,
        set: {
          industryKey,
          redirectUrl: redirect,
          thankYouUrl: thankYou,
          updatedAt: new Date(),
        },
      });

    // Return saved settings (fresh)
    const settingsRows = await db
      .select({
        tenant_id: tenantSettings.tenantId,
        industry_key: tenantSettings.industryKey,
        redirect_url: tenantSettings.redirectUrl,
        thank_you_url: tenantSettings.thankYouUrl,
        updated_at: tenantSettings.updatedAt,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenant.id))
      .limit(1);

    return NextResponse.json({
      ok: true,
      tenant: { id: tenant.id, slug: tenant.slug },
      settings: settingsRows[0] ?? null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
