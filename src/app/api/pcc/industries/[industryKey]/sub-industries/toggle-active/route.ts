//src/app/api/pcc/industries/[industryKey]/sub-industries/toggle-active/route.ts

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

const Body = z.object({
  key: z.string().min(1), // sub-industry key
  isActive: z.boolean(),
});

export async function POST(req: Request, ctx: { params: Promise<{ industryKey: string }> }) {
  // ✅ Owner-only
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
  if (!subKey || !isReasonableKey(subKey)) {
    return NextResponse.json({ ok: false, error: "INVALID_SUB_KEY" }, { status: 400 });
  }

  const isActive = Boolean(parsed.data.isActive);

  // Update active flag (no deletes)
  const r = await db.execute(sql`
    update industry_sub_industries
    set is_active = ${isActive}, updated_at = now()
    where industry_key = ${industryKey} and key = ${subKey}
    returning industry_key::text as "industryKey", key::text as "subKey", is_active as "isActive"
  `);

  const row = (r as any)?.rows?.[0] ?? null;
  if (!row) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    industryKey: String(row.industryKey),
    key: String(row.subKey),
    isActive: Boolean(row.isActive),
  });
}