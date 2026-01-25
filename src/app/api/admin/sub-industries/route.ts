// src/app/api/admin/sub-industries/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { tenants, tenantSettings, tenantSubIndustries } from "@/lib/db/schema";
import { mergeSubIndustries, normalizeKey } from "@/lib/industry/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getCookieTenantId(jar: Awaited<ReturnType<typeof cookies>>) {
  const candidates = [
    jar.get("activeTenantId")?.value,
    jar.get("active_tenant_id")?.value,
    jar.get("tenantId")?.value,
    jar.get("tenant_id")?.value,
  ].filter(Boolean) as string[];
  return candidates[0] || null;
}

const PostBody = z.object({
  key: z.string().min(1),
  label: z.string().min(1).optional(),
});

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });

    const jar = await cookies();
    let tenantId = getCookieTenantId(jar);

    // fallback: first tenant owned by user
    if (!tenantId) {
      const t = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.ownerClerkUserId, userId))
        .limit(1)
        .then((r) => r[0] ?? null);
      tenantId = t?.id ?? null;
    }

    if (!tenantId) return NextResponse.json({ ok: false, error: "NO_ACTIVE_TENANT" }, { status: 400 });

    const tenant = await db
      .select({ id: tenants.id, ownerClerkUserId: tenants.ownerClerkUserId })
      .from(tenants)
      .where(and(eq(tenants.id, tenantId), eq(tenants.ownerClerkUserId, userId)))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!tenant) return NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND_OR_NOT_OWNED" }, { status: 404 });

    const settings = await db
      .select({ industryKey: tenantSettings.industryKey })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenant.id))
      .limit(1)
      .then((r) => r[0] ?? null);

    const rows = await db
      .select({ key: tenantSubIndustries.key, label: tenantSubIndustries.label })
      .from(tenantSubIndustries)
      .where(eq(tenantSubIndustries.tenantId, tenant.id));

    const tenantCustom = rows.map((r) => ({ key: r.key, label: r.label }));
    const merged = mergeSubIndustries(settings?.industryKey ?? null, tenantCustom);

    return NextResponse.json(
      { ok: true, industry_key: settings?.industryKey ?? null, sub_industries: merged, tenant_custom: tenantCustom },
      { headers: { "cache-control": "no-store, max-age=0" } }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "INTERNAL", message: e?.message ?? String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });

    const jar = await cookies();
    let tenantId = getCookieTenantId(jar);

    if (!tenantId) {
      const t = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.ownerClerkUserId, userId))
        .limit(1)
        .then((r) => r[0] ?? null);
      tenantId = t?.id ?? null;
    }

    if (!tenantId) return NextResponse.json({ ok: false, error: "NO_ACTIVE_TENANT" }, { status: 400 });

    const tenant = await db
      .select({ id: tenants.id, ownerClerkUserId: tenants.ownerClerkUserId })
      .from(tenants)
      .where(and(eq(tenants.id, tenantId), eq(tenants.ownerClerkUserId, userId)))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!tenant) return NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND_OR_NOT_OWNED" }, { status: 404 });

    const json = await req.json().catch(() => null);
    const parsed = PostBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "INVALID_BODY", issues: parsed.error.issues }, { status: 400 });
    }

    const key = normalizeKey(parsed.data.key);
    const label = String(parsed.data.label ?? parsed.data.key).trim();

    if (!key) return NextResponse.json({ ok: false, error: "INVALID_KEY" }, { status: 400 });

    await db
      .insert(tenantSubIndustries)
      .values({
        id: crypto.randomUUID(),
        tenantId: tenant.id,
        key,
        label,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [tenantSubIndustries.tenantId, tenantSubIndustries.key],
        set: { label, updatedAt: new Date() },
      });

    return NextResponse.json({ ok: true, key, label });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "INTERNAL", message: e?.message ?? String(e) }, { status: 500 });
  }
}