// src/app/api/pcc/tenants/[tenantId]/confirm-industry/route.ts
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
  return String(v ?? "").trim();
}

function safeKey(v: unknown) {
  // industry keys are snake_case
  return decodeURIComponent(String(v ?? "")).trim().toLowerCase();
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function isReasonableIndustryKey(k: string) {
  return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(k);
}

async function maybeWriteAuditLog(args: {
  tenantId: string;
  action: string;
  detail: any;
}) {
  // Only write audit log if the table exists (so we never break prod builds)
  const existsR = await db.execute(sql`select to_regclass('public.tenant_audit_log')::text as "name"`);
  const exists = Boolean((existsR as any)?.rows?.[0]?.name);

  if (!exists) return;

  await db.execute(sql`
    insert into tenant_audit_log (tenant_id, action, detail, created_at)
    values (${args.tenantId}::uuid, ${args.action}, ${JSON.stringify(args.detail)}::jsonb, now())
  `);
}

export async function POST(req: Request, ctx: { params: { tenantId: string } }) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

  const rawTenantId = safeStr(ctx?.params?.tenantId);
  if (!rawTenantId) {
    return NextResponse.json({ ok: false, error: "MISSING_TENANT_ID" }, { status: 400 });
  }

  // tenantId should be a UUID; do not lowercase/transform it beyond trimming
  const tenantId = rawTenantId;
  if (!isUuid(tenantId)) {
    return NextResponse.json({ ok: false, error: "INVALID_TENANT_ID" }, { status: 400 });
  }

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY" }, { status: 400 });
  }

  const industryKey = safeKey(parsed.data.industryKey);
  if (!industryKey) {
    return NextResponse.json({ ok: false, error: "MISSING_INDUSTRY_KEY" }, { status: 400 });
  }
  if (!isReasonableIndustryKey(industryKey)) {
    return NextResponse.json({ ok: false, error: "INVALID_INDUSTRY_KEY" }, { status: 400 });
  }

  // 1) Ensure tenant_settings row exists, then set industry_key
  await db.execute(sql`
    insert into tenant_settings (tenant_id, industry_key, updated_at)
    values (${tenantId}::uuid, ${industryKey}, now())
    on conflict (tenant_id)
    do update set industry_key = excluded.industry_key, updated_at = now()
  `);

  // 2) Mark onboarding AI as no longer needing confirmation (best-effort even if row doesn't exist)
  // We set both camelCase + snake_case fields to be safe.
  await db.execute(sql`
    update tenant_onboarding
    set ai_analysis =
      jsonb_set(
        jsonb_set(
          coalesce(ai_analysis, '{}'::jsonb),
          '{needsConfirmation}',
          'false'::jsonb,
          true
        ),
        '{needs_confirmation}',
        'false'::jsonb,
        true
      )
    where tenant_id = ${tenantId}::uuid
  `);

  // 3) Audit (optional if table exists)
  await maybeWriteAuditLog({
    tenantId,
    action: "pcc_confirm_industry",
    detail: { industryKey },
  });

  return NextResponse.json({ ok: true, tenantId, industryKey });
}