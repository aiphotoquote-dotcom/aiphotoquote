// src/app/api/pcc/tenants/[tenantId]/set-industry/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  industryKey: z.string().min(1),
  source: z.string().optional(),
  previousSuggestedIndustryKey: z.string().nullable().optional(),
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
  const source = safeStr(parsed.data.source ?? "pcc_set_industry");
  const prev = parsed.data.previousSuggestedIndustryKey ? safeIndustryKey(parsed.data.previousSuggestedIndustryKey) : null;

  if (!tenantId) return NextResponse.json({ ok: false, error: "MISSING_TENANT_ID" }, { status: 400 });
  if (!isUuid(tenantId)) return NextResponse.json({ ok: false, error: "INVALID_TENANT_ID" }, { status: 400 });

  if (!industryKey) return NextResponse.json({ ok: false, error: "MISSING_INDUSTRY_KEY" }, { status: 400 });
  if (!isReasonableIndustryKey(industryKey)) {
    return NextResponse.json({ ok: false, error: "INVALID_INDUSTRY_KEY" }, { status: 400 });
  }

  // Ensure tenant_settings row exists, then set industry_key
  await db.execute(sql`
    insert into tenant_settings (tenant_id, industry_key, updated_at)
    values (${tenantId}::uuid, ${industryKey}, now())
    on conflict (tenant_id)
    do update set industry_key = excluded.industry_key, updated_at = now()
  `);

  // Ensure onboarding row exists (best-effort)
  await db.execute(sql`
    insert into tenant_onboarding (tenant_id, ai_analysis)
    values (${tenantId}::uuid, '{}'::jsonb)
    on conflict (tenant_id) do nothing
  `);

  // Update onboarding markers so PCC reflects that this tenant is now assigned.
  // We do NOT overwrite the whole ai_analysis; we just set a couple safe fields.
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
            '"reassigned"'::jsonb,
            true
          ),
          '{meta,source}',
          to_jsonb(${source}::text),
          true
        ),
        '{meta,previousSuggestedIndustryKey}',
        case
          when ${prev}::text is null then (ai_analysis->'meta'->'previousSuggestedIndustryKey')
          else to_jsonb(${prev}::text)
        end,
        true
      ),
      updated_at = now()
    where tenant_id = ${tenantId}::uuid
  `);

  // Optional: clearing suggestedIndustryKey can be useful so the tenant no longer appears under an AI-suggested bucket
  // that doesn’t match their new assignment. We only do this when a prev suggested key was provided (meaning we are
  // explicitly correcting a prior suggestion).
  if (prev) {
    await db.execute(sql`
      update tenant_onboarding
      set ai_analysis = jsonb_set(
        coalesce(ai_analysis, '{}'::jsonb),
        '{suggestedIndustryKey}',
        'null'::jsonb,
        true
      )
      where tenant_id = ${tenantId}::uuid
    `);
  }

  // Optional audit log (don’t fail the request if table doesn’t exist)
  try {
    await db.execute(sql`
      insert into tenant_audit_log (tenant_id, action, meta, created_at)
      values (
        ${tenantId}::uuid,
        'pcc_set_industry',
        jsonb_build_object(
          'industryKey', ${industryKey},
          'source', ${source},
          'previousSuggestedIndustryKey', ${prev}
        ),
        now()
      )
    `);
  } catch {
    // ignore
  }

  return NextResponse.json({ ok: true });
}