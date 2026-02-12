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
  // snake_case-ish (same rule you used for industry_key)
  return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(k);
}

const Body = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional().nullable(),
  sortOrder: z.number().int().optional().nullable(),
});

export async function POST(req: Request, ctx: { params: Promise<{ industryKey: string }> }) {
  // ✅ Owner-only per your instruction
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
  const sortOrder = Number.isFinite(parsed.data.sortOrder as any) ? Number(parsed.data.sortOrder) : 100;

  if (!subKey || !isReasonableKey(subKey)) {
    return NextResponse.json({ ok: false, error: "INVALID_SUB_KEY" }, { status: 400 });
  }
  if (!label) {
    return NextResponse.json({ ok: false, error: "MISSING_LABEL" }, { status: 400 });
  }

  // Upsert default sub-industry
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

  // Audit log (platform-level action; no tenantId available here)
  // If your DB enforces tenant_id NOT NULL on tenant_audit_log, tell me and we’ll switch to a platform_audit_log table instead.
  await db.execute(sql`
    insert into tenant_audit_log (
      id,
      tenant_id,
      action,
      actor_clerk_user_id,
      actor_email,
      actor_ip,
      reason,
      meta,
      created_at
    )
    values (
      gen_random_uuid(),
      ${"00000000-0000-0000-0000-000000000000"}::uuid,
      ${"industry_sub_industry.upserted"},
      null,
      null,
      null,
      null,
      jsonb_build_object(
        'industryKey', ${industryKey},
        'subIndustryKey', ${subKey},
        'label', ${label},
        'sortOrder', ${sortOrder}
      ),
      now()
    )
  `);

  return NextResponse.json({ ok: true, industryKey, key: subKey });
}