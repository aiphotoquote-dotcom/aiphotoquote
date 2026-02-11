// src/app/api/pcc/tenants/[tenantId]/reject-industry/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  industryKey: z.string().min(1),
});

function safeStr(v: unknown) {
  return decodeURIComponent(String(v ?? "")).trim();
}

function safeIndustryKey(v: unknown) {
  return safeStr(v).toLowerCase();
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function isReasonableIndustryKey(k: string) {
  // allow snake_case keys like roofing_services, collision_repair, etc.
  return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(k);
}

export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

  const { tenantId: rawTenantId } = await ctx.params;
  const tenantId = safeStr(rawTenantId);

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_BODY" }, { status: 400 });

  const industryKey = safeIndustryKey(parsed.data.industryKey);

  if (!tenantId) return NextResponse.json({ ok: false, error: "MISSING_TENANT_ID" }, { status: 400 });
  if (!isUuid(tenantId)) return NextResponse.json({ ok: false, error: "INVALID_TENANT_ID" }, { status: 400 });
  if (!industryKey) return NextResponse.json({ ok: false, error: "MISSING_INDUSTRY_KEY" }, { status: 400 });
  if (!isReasonableIndustryKey(industryKey)) {
    return NextResponse.json({ ok: false, error: "INVALID_INDUSTRY_KEY" }, { status: 400 });
  }

  // Ensure onboarding row exists (best-effort)
  await db.execute(sql`
    insert into tenant_onboarding (tenant_id, ai_analysis)
    values (${tenantId}::uuid, '{}'::jsonb)
    on conflict (tenant_id) do nothing
  `);

  // Durable rejection marker in ai_analysis:
  // - add industryKey to rejectedIndustryKeys array (deduped)
  // - set meta.status = "rejected"
  // - clear suggestedIndustryKey so it stops showing under that industry’s AI list
  // - set needsConfirmation false
  await db.execute(sql`
    update tenant_onboarding
    set ai_analysis =
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              coalesce(ai_analysis, '{}'::jsonb),
              '{needsConfirmation}',
              'false'::jsonb,
              true
            ),
            '{meta,status}',
            '"rejected"'::jsonb,
            true
          ),
          '{suggestedIndustryKey}',
          'null'::jsonb,
          true
        ),
        '{rejectedIndustryKeys}',
        (
          with existing as (
            select jsonb_array_elements_text(coalesce(ai_analysis->'rejectedIndustryKeys', '[]'::jsonb)) as k
          )
          select to_jsonb(array(
            select distinct v
            from (
              select k as v from existing
              union all
              select ${industryKey} as v
            ) x
            where v is not null and btrim(v) <> ''
            order by v
          ))
        ),
        true
      ),
      updated_at = now()
    where tenant_id = ${tenantId}::uuid
  `);

  // Optional audit log (don’t fail the request if table doesn’t exist)
  try {
    await db.execute(sql`
      insert into tenant_audit_log (tenant_id, action, meta, created_at)
      values (
        ${tenantId}::uuid,
        'pcc_reject_industry',
        jsonb_build_object('rejectedIndustryKey', ${industryKey}),
        now()
      )
    `);
  } catch {
    // ignore
  }

  return NextResponse.json({ ok: true });
}