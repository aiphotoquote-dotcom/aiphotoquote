import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { tenants, tenantSettings } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  tenantSlug: z.string().min(3),
  industry_key: z.string().min(1),

  // Accept both snake_case + camelCase from any UI variant
  redirect_url: z.string().nullable().optional(),
  thank_you_url: z.string().nullable().optional(),
  redirectUrl: z.string().nullable().optional(),
  thankYouUrl: z.string().nullable().optional(),
});

function normUrl(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;

  // allow relative paths if you want (optional). For now enforce absolute http(s)
  // If you DO want to allow "/thank-you", comment out the next block.
  if (!/^https?:\/\//i.test(s)) {
    // try to auto-fix common case
    if (/^[a-z0-9.-]+\.[a-z]{2,}([/:]|$)/i.test(s)) return `https://${s}`;
    return s; // keep as-is (don’t silently drop)
  }

  return s;
}

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return json({ ok: false, error: "UNAUTHENTICATED" }, 401);

    const raw = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return json(
        { ok: false, error: "INVALID_BODY", issues: parsed.error.issues },
        400
      );
    }

    const {
      tenantSlug,
      industry_key,
      redirect_url,
      thank_you_url,
      redirectUrl,
      thankYouUrl,
    } = parsed.data;

    // Resolve tenant owned by this user (slug is unique)
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.slug, tenantSlug),
    });

    if (!tenant) return json({ ok: false, error: "TENANT_NOT_FOUND" }, 404);
    if (String(tenant.ownerClerkUserId ?? "") !== String(userId)) {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const redirect = normUrl(redirect_url ?? redirectUrl);
    const thankYou = normUrl(thank_you_url ?? thankYouUrl);

    // ✅ Upsert into tenant_settings (tenant_id is PK in your DB)
    // Drizzle can struggle with onConflictDoUpdate depending on setup,
    // so use a safe SQL upsert that matches your real schema.
    await db.execute(sql`
      insert into tenant_settings (tenant_id, industry_key, redirect_url, thank_you_url, updated_at)
      values (${tenant.id}, ${industry_key}, ${redirect}, ${thankYou}, now())
      on conflict (tenant_id) do update set
        industry_key = excluded.industry_key,
        redirect_url = excluded.redirect_url,
        thank_you_url = excluded.thank_you_url,
        updated_at = now()
    `);

    // Read back what we saved (source of truth)
    const rows = await db
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenant.id))
      .limit(1);

    const s: any = rows[0] ?? null;

    return json({
      ok: true,
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      settings: s
        ? {
            tenant_id: s.tenantId,
            industry_key: s.industryKey ?? null,

            // return BOTH shapes
            redirect_url: s.redirectUrl ?? null,
            thank_you_url: s.thankYouUrl ?? null,
            redirectUrl: s.redirectUrl ?? null,
            thankYouUrl: s.thankYouUrl ?? null,

            updated_at: s.updatedAt ? String(s.updatedAt) : null,
          }
        : null,
    });
  } catch (e: any) {
    return json(
      { ok: false, error: "SAVE_SETTINGS_FAILED", message: e?.message ?? String(e) },
      500
    );
  }
}
