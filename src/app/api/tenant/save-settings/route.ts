// src/app/api/tenant/save-settings/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db/client";
import { tenants, tenantSettings } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Save tenant settings (industry, URLs, reporting prefs)
 * Called from TenantOnboardingForm.
 */

const Body = z
  .object({
    // support both casings
    tenantSlug: z.string().min(3).optional(),
    tenant_slug: z.string().min(3).optional(),

    industryKey: z.string().min(1).optional(),
    industry_key: z.string().min(1).optional(),

    redirectUrl: z.string().optional().nullable(),
    redirect_url: z.string().optional().nullable(),

    thankYouUrl: z.string().optional().nullable(),
    thank_you_url: z.string().optional().nullable(),

    // NEW reporting settings (support both)
    timeZone: z.string().optional().nullable(),
    time_zone: z.string().optional().nullable(),

    weekStart: z.string().optional().nullable(),
    week_start: z.string().optional().nullable(),
  })
  .passthrough();

function pickString(obj: any, camel: string, snake: string) {
  const a = obj?.[camel];
  if (typeof a === "string") return a;
  const b = obj?.[snake];
  if (typeof b === "string") return b;
  return "";
}

function pickNullableString(obj: any, camel: string, snake: string) {
  const a = obj?.[camel];
  if (typeof a === "string") return a;
  if (a === null) return null;
  const b = obj?.[snake];
  if (typeof b === "string") return b;
  if (b === null) return null;
  return undefined; // means "not provided"
}

function normalizeUrl(u: string | null | undefined) {
  const s = String(u ?? "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return `https://${s}`;
  return s;
}

function normalizeWeekStart(v: string | null | undefined) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "monday";
  // keep it flexible, but normalize common inputs
  if (s.startsWith("mon")) return "monday";
  if (s.startsWith("sun")) return "sunday";
  if (s.startsWith("sat")) return "saturday";
  if (s.startsWith("tue")) return "tuesday";
  if (s.startsWith("wed")) return "wednesday";
  if (s.startsWith("thu")) return "thursday";
  if (s.startsWith("fri")) return "friday";
  return s;
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }

    const raw = await req.json().catch(() => null);
    const parsed = Body.safeParse(raw);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "INVALID_BODY", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const data: any = parsed.data;

    const tenantSlug = pickString(data, "tenantSlug", "tenant_slug").trim();
    const industryKey = pickString(data, "industryKey", "industry_key").trim();

    if (tenantSlug.length < 3 || industryKey.length < 1) {
      return NextResponse.json(
        { ok: false, error: "MISSING_REQUIRED_FIELDS" },
        { status: 400 }
      );
    }

    const redirectRaw = pickNullableString(data, "redirectUrl", "redirect_url");
    const thankYouRaw = pickNullableString(data, "thankYouUrl", "thank_you_url");

    const timeZoneRaw = pickNullableString(data, "timeZone", "time_zone");
    const weekStartRaw = pickNullableString(data, "weekStart", "week_start");

    const redirectUrl = redirectRaw === undefined ? undefined : normalizeUrl(redirectRaw);
    const thankYouUrl = thankYouRaw === undefined ? undefined : normalizeUrl(thankYouRaw);

    const timeZone =
      timeZoneRaw === undefined ? undefined : String(timeZoneRaw ?? "").trim() || null;

    const weekStart =
      weekStartRaw === undefined ? undefined : normalizeWeekStart(weekStartRaw);

    // Resolve tenant owned by this user
    const tenant = await db
      .select({
        id: tenants.id,
        slug: tenants.slug,
        ownerClerkUserId: tenants.ownerClerkUserId,
      })
      .from(tenants)
      .where(and(eq(tenants.slug, tenantSlug), eq(tenants.ownerClerkUserId, userId)))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!tenant) {
      return NextResponse.json(
        { ok: false, error: "TENANT_NOT_FOUND_OR_NOT_OWNED" },
        { status: 404 }
      );
    }

    // Build update set (only set optional fields if provided)
    const baseSet: any = {
      industryKey,
      updatedAt: new Date(),
    };

    if (redirectUrl !== undefined) baseSet.redirectUrl = redirectUrl;
    if (thankYouUrl !== undefined) baseSet.thankYouUrl = thankYouUrl;

    // NEW reporting fields
    if (timeZone !== undefined) baseSet.timeZone = timeZone;
    if (weekStart !== undefined) baseSet.weekStart = weekStart;

    // Upsert tenant_settings (tenant_id is PK)
    await db
      .insert(tenantSettings)
      .values({
        tenantId: tenant.id,
        industryKey,
        redirectUrl: redirectUrl === undefined ? null : redirectUrl,
        thankYouUrl: thankYouUrl === undefined ? null : thankYouUrl,
        timeZone: timeZone === undefined ? null : timeZone,
        weekStart: weekStart === undefined ? "monday" : weekStart,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: tenantSettings.tenantId,
        set: baseSet,
      });

    // Return saved settings (snake_case response)
    const settingsRow = await db
      .select({
        tenant_id: tenantSettings.tenantId,
        industry_key: tenantSettings.industryKey,
        redirect_url: tenantSettings.redirectUrl,
        thank_you_url: tenantSettings.thankYouUrl,
        updated_at: tenantSettings.updatedAt,
        time_zone: tenantSettings.timeZone,
        week_start: tenantSettings.weekStart,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenant.id))
      .limit(1)
      .then((r) => r[0] ?? null);

    return NextResponse.json({
      ok: true,
      tenant: { id: tenant.id, slug: tenant.slug },
      settings: settingsRow,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
