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

function safeKey(v: string) {
  return decodeURIComponent(String(v ?? "")).trim().toLowerCase();
}

function isReasonableIndustryKey(k: string) {
  return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(k);
}

export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

  const { tenantId: rawTenantId } = await ctx.params;
  const tenantId = safeKey(rawTenantId);

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY" }, { status: 400 });
  }

  const industryKey = safeKey(parsed.data.industryKey);
  if (!tenantId) return NextResponse.json({ ok: false, error: "MISSING_TENANT_ID" }, { status: 400 });
  if (!isReasonableIndustryKey(industryKey)) {
    return NextResponse.json({ ok: false, error: "INVALID_INDUSTRY_KEY" }, { status: 400 });
  }

  // Store a durable rejection marker in ai_analysis:
  // - add industryKey to rejectedIndustryKeys array (deduped)
  // - set meta.status = "rejected"
  // - clear suggestedIndustryKey so it stops showing under that industry’s AI list
  // - set needsConfirmation false
  await db.execute(sql`
    update tenant_onboarding
    set ai_analysis =
      (
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
            select to_jsonb(
              (
                select array_agg(distinct x)
                from unnest(
                  coalesce(
                    (select array_agg(e::text) from jsonb_array_elements_text(coalesce(ai_analysis->'rejectedIndustryKeys','[]'::jsonb)) e),
                    '{}'::text[]
                  )
                  || array[${industryKey}]
                ) as x
              )
            )
          ),
          true
        )
      )
    where tenant_id = ${tenantId}::uuid
  `);

  return NextResponse.json({ ok: true });
}