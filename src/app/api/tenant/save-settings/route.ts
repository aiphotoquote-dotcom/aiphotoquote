import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db/client";
import { tenants, tenantSettings } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Accept BOTH camelCase and snake_case.
 * Your UI currently sends snake_case, so we must support that.
 */
const Body = z.object({
  tenantSlug: z.string().min(3),

  // industry required (either key)
  industryKey: z.string().min(1).optional(),
  industry_key: z.string().min(1).optional(),

  redirectUrl: z.string().optional().nullable(),
  redirect_url: z.string().optional().nullable(),

  thankYouUrl: z.string().optional().nullable(),
  thank_you_url: z.string().optional().nullable(),

  reportingTimezone: z.string().optional().nullable(),
  reporting_timezone: z.string().optional().nullable(),

  weekStartsOn: z.number().int().min(0).max(6).optional().nullable(),
  week_starts_on: z.number().int().min(0).max(6).optional().nullable(),
});

function normalizeUrl(u: string | null | undefined) {
  const s = String(u ?? "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return `https://${s}`;
  return s;
}

function pick<T>(a: T | undefined, b: T | undefined): T | undefined {
  return a !== undefined ? a : b;
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

    const data = parsed.data;

    const industryKey = pick(data.industryKey, data.industry_key);
    if (!industryKey) {
      return NextResponse.json(
        { ok: false, error: "INVALID_BODY", message: "industryKey is required" },
        { status: 400 }
      );
    }

    const redirectRaw = pick(data.redirectUrl, data.redirect_url) ?? null;
    const thankYouRaw = pick(data.thankYouUrl, data.thank_you_url) ?? null;

    const reportingTimezone =
      (pick(data.reportingTimezone, data.reporting_timezone) ?? "").trim() || null;

    const weekStartsOn = pick(data.weekStartsOn, data.week_starts_on) ?? null;

    // Resolve tenant owned by this user (slug is unique)
    const tenantRows = await db
      .select({
        id: tenants.id,
        slug: tenants.slug,
        ownerClerkUserId: tenants.ownerClerkUserId,
      })
      .from(tenants)
      .where(and(eq(tenants.slug, data.tenantSlug), eq(tenants.ownerClerkUserId, userId)))
      .limit(1);

    const tenant = tenantRows[0] ?? null;
    if (!tenant) {
      return NextResponse.json(
        { ok: false, error: "TENANT_NOT_FOUND_OR_NOT_OWNED" },
        { status: 404 }
      );
    }

    const redirect = normalizeUrl(redirectRaw);
    const thankYou = normalizeUrl(thankYouRaw);

    await db
      .insert(tenantSettings)
      .values({
        tenantId: tenant.id,
        industryKey,
        redirectUrl: redirect,
        thankYouUrl: thankYou,
        reportingTimezone,
        weekStartsOn,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: tenantSettings.tenantId,
        set: {
          industryKey,
          redirectUrl: redirect,
          thankYouUrl: thankYou,
          reportingTimezone,
          weekStartsOn,
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
        reporting_timezone: tenantSettings.reportingTimezone,
        week_starts_on: tenantSettings.weekStartsOn,
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
