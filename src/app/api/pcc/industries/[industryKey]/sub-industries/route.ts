// src/app/api/pcc/industries/[industryKey]/sub-industries/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeKey(v: any) {
  return decodeURIComponent(String(v ?? "")).trim().toLowerCase();
}

function isReasonableKey(k: string) {
  // snake_case-ish
  return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(k);
}

function rows(r: any): any[] {
  return (r as any)?.rows ?? (Array.isArray(r) ? r : []);
}

function toBool(v: any) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v ?? "").toLowerCase().trim();
  return s === "true" || s === "t" || s === "1" || s === "yes";
}

const Body = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional().nullable(),
  sortOrder: z.number().int().optional().nullable(),
});

/**
 * GET: list default sub-industries for an industry
 * (useful for admin tools / debugging; PCC page does its own SQL today)
 */
export async function GET(req: Request, ctx: { params: Promise<{ industryKey: string }> }) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

  const { industryKey: rawIndustryKey } = await ctx.params;
  const industryKey = safeKey(rawIndustryKey);

  if (!industryKey) {
    return NextResponse.json({ ok: false, error: "MISSING_INDUSTRY_KEY" }, { status: 400 });
  }
  if (!isReasonableKey(industryKey)) {
    return NextResponse.json({ ok: false, error: "INVALID_INDUSTRY_KEY" }, { status: 400 });
  }

  const u = new URL(req.url);
  const showInactive = toBool(u.searchParams.get("showInactive"));

  const r = await db.execute(sql`
    select
      id::text as "id",
      industry_key::text as "industryKey",
      key::text as "key",
      label::text as "label",
      description::text as "description",
      sort_order::int as "sortOrder",
      is_active as "isActive",
      created_at as "createdAt",
      updated_at as "updatedAt"
    from industry_sub_industries
    where industry_key = ${industryKey}
      and (${showInactive} = true or is_active = true)
    order by sort_order asc, label asc
    limit 500
  `);

  return NextResponse.json({
    ok: true,
    industryKey,
    subIndustries: rows(r).map((x: any) => ({
      id: String(x.id ?? ""),
      industryKey: String(x.industryKey ?? industryKey),
      key: String(x.key ?? ""),
      label: String(x.label ?? ""),
      description: x.description == null ? null : String(x.description),
      sortOrder: Number(x.sortOrder ?? 1000) || 1000,
      isActive: Boolean(x.isActive),
      createdAt: x.createdAt ?? null,
      updatedAt: x.updatedAt ?? null,
    })),
  });
}

/**
 * POST: upsert a default sub-industry
 * (kept for back-compat if anything calls this endpoint directly)
 */
export async function POST(req: Request, ctx: { params: Promise<{ industryKey: string }> }) {
  await requirePlatformRole(["platform_owner"]);

  const { industryKey: rawIndustryKey } = await ctx.params;
  const industryKey = safeKey(rawIndustryKey);

  if (!industryKey) {
    return NextResponse.json({ ok: false, error: "MISSING_INDUSTRY_KEY" }, { status: 400 });
  }
  if (!isReasonableKey(industryKey)) {
    return NextResponse.json({ ok: false, error: "INVALID_INDUSTRY_KEY" }, { status: 400 });
  }

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY" }, { status: 400 });
  }

  const subKey = safeKey(parsed.data.key);
  const label = String(parsed.data.label ?? "").trim();
  const description = parsed.data.description ? String(parsed.data.description).trim() : null;
  const sortOrder = Number.isFinite(parsed.data.sortOrder as any) ? Number(parsed.data.sortOrder) : 1000;

  if (!subKey || !isReasonableKey(subKey)) {
    return NextResponse.json({ ok: false, error: "INVALID_SUB_KEY" }, { status: 400 });
  }
  if (!label) {
    return NextResponse.json({ ok: false, error: "MISSING_LABEL" }, { status: 400 });
  }

  await db.execute(sql`
    insert into industry_sub_industries (
      industry_key,
      key,
      label,
      description,
      sort_order,
      is_active,
      created_at,
      updated_at
    )
    values (
      ${industryKey},
      ${subKey},
      ${label},
      ${description},
      ${sortOrder}::int,
      true,
      now(),
      now()
    )
    on conflict (industry_key, key)
    do update set
      label = excluded.label,
      description = excluded.description,
      sort_order = excluded.sort_order,
      is_active = true,
      updated_at = now()
  `);

  // IMPORTANT: do NOT write to tenant_audit_log here; it requires a real tenant_id FK.

  return NextResponse.json({ ok: true, industryKey, key: subKey });
}