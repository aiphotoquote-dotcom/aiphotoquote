// src/app/api/onboarding/industries/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function normalizeKey(v: string) {
  const base = safeTrim(v)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return base || "service";
}

function firstRow(r: any): any | null {
  if (!r) return null;
  if (Array.isArray(r)) return r[0] ?? null;
  if (Array.isArray(r.rows)) return r.rows[0] ?? null;
  return null;
}

async function requireAuthed(): Promise<{ clerkUserId: string }> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHENTICATED");
  return { clerkUserId: userId };
}

async function requireMembership(clerkUserId: string, tenantId: string): Promise<void> {
  const r = await db.execute(sql`
    select 1 as ok
    from tenant_members
    where tenant_id = ${tenantId}::uuid
      and clerk_user_id = ${clerkUserId}
    limit 1
  `);
  const row = firstRow(r);
  if (!row?.ok) throw new Error("FORBIDDEN_TENANT");
}

function getTenantIdFromReq(req: Request): string {
  try {
    const u = new URL(req.url);
    return safeTrim(u.searchParams.get("tenantId"));
  } catch {
    return "";
  }
}

/**
 * GET: return platform industries + tenant-specific sub-industries
 * POST: set selected industry for tenant (platform or tenant sub-industry)
 */
export async function GET(req: Request) {
  try {
    const { clerkUserId } = await requireAuthed();
    const tenantId = getTenantIdFromReq(req);
    if (!tenantId) return NextResponse.json({ ok: false, error: "TENANT_ID_REQUIRED" }, { status: 400 });

    await requireMembership(clerkUserId, tenantId);

    const rPlatform = await db.execute(sql`
      select id, key, label, description
      from industries
      order by label asc
    `);

    const platformRows: any[] = (rPlatform as any)?.rows ?? [];
    const platform = platformRows.map((x) => ({
      id: String(x.id),
      key: String(x.key),
      label: String(x.label),
      description: x.description ? String(x.description) : null,
      source: "platform" as const,
    }));

    const rTenant = await db.execute(sql`
      select id, key, label
      from tenant_sub_industries
      where tenant_id = ${tenantId}::uuid
      order by label asc
    `);

    const tenantRows: any[] = (rTenant as any)?.rows ?? [];
    const tenant = tenantRows.map((x) => ({
      id: String(x.id),
      key: String(x.key),
      label: String(x.label),
      description: null,
      source: "tenant" as const,
    }));

    const rSel = await db.execute(sql`
      select industry_key
      from tenant_settings
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);

    const selRow: any = (rSel as any)?.rows?.[0] ?? null;
    const selectedKey = selRow?.industry_key ? String(selRow.industry_key) : null;

    return NextResponse.json(
      { ok: true, tenantId, selectedKey, industries: [...platform, ...tenant] },
      { status: 200 }
    );
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const { clerkUserId } = await requireAuthed();

    const body = await req.json().catch(() => null);
    const tenantId = safeTrim(body?.tenantId);
    if (!tenantId) return NextResponse.json({ ok: false, error: "TENANT_ID_REQUIRED" }, { status: 400 });

    await requireMembership(clerkUserId, tenantId);

    const rawKey = safeTrim(body?.industryKey);
    const rawLabel = safeTrim(body?.industryLabel);

    let keyToSet = rawKey ? normalizeKey(rawKey) : "";
    let createdSubIndustryId: string | null = null;

    if (rawLabel) {
      const key = keyToSet || normalizeKey(rawLabel);

      const rUpsert = await db.execute(sql`
        insert into tenant_sub_industries (id, tenant_id, key, label, updated_at)
        values (gen_random_uuid(), ${tenantId}::uuid, ${key}, ${rawLabel}, now())
        on conflict (tenant_id, key) do update
        set label = excluded.label,
            updated_at = now()
        returning id
      `);

      const row: any = (rUpsert as any)?.rows?.[0] ?? null;
      createdSubIndustryId = row?.id ? String(row.id) : null;
      keyToSet = key;
    }

    if (!keyToSet) {
      return NextResponse.json({ ok: false, error: "INDUSTRY_REQUIRED" }, { status: 400 });
    }

    await db.execute(sql`
      insert into tenant_settings (tenant_id, industry_key, updated_at)
      values (${tenantId}::uuid, ${keyToSet}, now())
      on conflict (tenant_id) do update
      set industry_key = excluded.industry_key,
          updated_at = now()
    `);

    await db.execute(sql`
      insert into tenant_onboarding (tenant_id, current_step, completed, created_at, updated_at)
      values (${tenantId}::uuid, 3, false, now(), now())
      on conflict (tenant_id) do update
      set current_step = greatest(tenant_onboarding.current_step, 3),
          updated_at = now()
    `);

    return NextResponse.json({ ok: true, tenantId, industryKey: keyToSet, createdSubIndustryId }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}