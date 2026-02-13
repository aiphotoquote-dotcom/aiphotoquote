// src/app/api/pcc/industries/[industryKey]/sub-industries/toggle-active/route.ts
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
  return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(k);
}

const Body = z.object({
  key: z.string().min(1), // sub-industry key
  isActive: z.boolean(),
});

function rows(r: any): any[] {
  return (r as any)?.rows ?? (Array.isArray(r) ? r : []);
}

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
  const isActive = Boolean(parsed.data.isActive);

  if (!subKey || !isReasonableKey(subKey)) {
    return NextResponse.json({ ok: false, error: "INVALID_SUB_KEY" }, { status: 400 });
  }

  const r = await db.execute(sql`
    update industry_sub_industries
    set
      is_active = ${isActive},
      updated_at = now()
    where industry_key = ${industryKey}
      and key = ${subKey}
    returning id::text as "id", key::text as "key"
  `);

  const rr = rows(r);
  if (!rr.length) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND", industryKey, key: subKey }, { status: 404 });
  }

  return NextResponse.json({ ok: true, industryKey, key: String(rr[0].key ?? subKey), isActive });
}