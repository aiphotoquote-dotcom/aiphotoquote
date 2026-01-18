import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Req = z.object({
  tenantSlug: z.string().min(3).max(64),
  industry_key: z.string().min(1).max(64),
  redirect_url: z.string().optional().nullable(),
  thank_you_url: z.string().optional().nullable(),
});

function cleanUrl(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;

  // Allow absolute URLs only (prevents weird relative paths in email redirects)
  // If you *want* to allow relative later, loosen this.
  if (!/^https?:\/\//i.test(s)) return `https://${s}`;
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
    const parsed = Req.safeParse(raw);
    if (!parsed.success) {
      return json(
        { ok: false, error: "BAD_REQUEST", issues: parsed.error.issues },
        400
      );
    }

    const { tenantSlug, industry_key } = parsed.data;
    const redirect_url = cleanUrl(parsed.data.redirect_url);
    const thank_you_url = cleanUrl(parsed.data.thank_you_url);

    // Tenant lookup by owner
    const tRes = await db.execute(sql`
      select id, name, slug
      from tenants
      where owner_clerk_user_id = ${userId}
      order by created_at desc
      limit 1
    `);
    const tRow: any = (tRes as any)?.rows?.[0] ?? (Array.isArray(tRes) ? (tRes as any)[0] : null);
    if (!tRow?.id) return json({ ok: false, error: "NO_TENANT" }, 404);

    const tenantId = String(tRow.id);

    // Update slug on tenants (if changed)
    // (slug uniqueness enforced by DB index)
    if (tenantSlug && tenantSlug !== String(tRow.slug)) {
      await db
        .update(tenants)
        .set({ slug: tenantSlug })
        .where(eq(tenants.id, tenantId as any));
    }

    // Upsert tenant_settings (tenant_id is PK in your DB)
    await db.execute(sql`
      insert into tenant_settings (tenant_id, industry_key, redirect_url, thank_you_url, updated_at)
      values (${tenantId}::uuid, ${industry_key}, ${redirect_url}, ${thank_you_url}, now())
      on conflict (tenant_id)
      do update set
        industry_key = excluded.industry_key,
        redirect_url = excluded.redirect_url,
        thank_you_url = excluded.thank_you_url,
        updated_at = now()
    `);

    return json({
      ok: true,
      tenant: { id: tenantId, slug: tenantSlug },
      settings: {
        tenant_id: tenantId,
        industry_key,
        redirect_url,
        thank_you_url,
        updated_at: new Date().toISOString(),
      },
    });
  } catch (e: any) {
    return json(
      { ok: false, error: "SAVE_SETTINGS_FAILED", message: e?.message ?? String(e) },
      500
    );
  }
}
