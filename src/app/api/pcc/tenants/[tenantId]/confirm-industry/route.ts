// src/app/api/pcc/tenants/[tenantId]/confirm-industry/route.ts
import { NextResponse, type NextRequest } from "next/server";
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

export async function POST(req: NextRequest, context: { params: { tenantId: string } }) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

  const tenantId = safeKey(context.params.tenantId || "");
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: "MISSING_TENANT_ID" }, { status: 400 });
  }

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY" }, { status: 400 });
  }

  const industryKey = safeKey(parsed.data.industryKey);
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

  // Mark onboarding AI as no longer needing confirmation (best-effort)
  await db.execute(sql`
    update tenant_onboarding
    set ai_analysis = jsonb_set(
      coalesce(ai_analysis, '{}'::jsonb),
      '{needsConfirmation}',
      'false'::jsonb,
      true
    )
    where tenant_id = ${tenantId}::uuid
  `);

  return NextResponse.json({ ok: true, tenantId, industryKey });
}