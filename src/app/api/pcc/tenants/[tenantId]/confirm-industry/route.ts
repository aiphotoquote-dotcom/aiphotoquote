// src/app/api/pcc/tenants/[tenantId]/confirm-industry/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  tenantId: z.string().uuid(),
});

const BodySchema = z.object({
  industryKey: z.string().min(1),
});

function rows(r: any): any[] {
  return (r as any)?.rows ?? (Array.isArray(r) ? r : []);
}

function firstRow(r: any): any | null {
  return rows(r)[0] ?? null;
}

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

export async function POST(req: NextRequest, context: { params: Promise<{ tenantId: string }> }) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

  const p = await context.params;
  const parsedParams = ParamsSchema.safeParse(p);
  if (!parsedParams.success) {
    return NextResponse.json({ ok: false, error: "INVALID_PARAMS", issues: parsedParams.error.issues }, { status: 400 });
  }

  const bodyJson = await req.json().catch(() => null);
  const parsedBody = BodySchema.safeParse(bodyJson);
  if (!parsedBody.success) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY", issues: parsedBody.error.issues }, { status: 400 });
  }

  const tenantId = parsedParams.data.tenantId;
  const nextIndustryKey = safeTrim(parsedBody.data.industryKey);

  // Load current (if any)
  const currentR = await db.execute(sql`
    select
      ts.industry_key::text as "industryKey"
    from tenant_settings ts
    where ts.tenant_id = ${tenantId}::uuid
    limit 1
  `);

  const cur = firstRow(currentR);
  const prevIndustryKey = safeTrim(cur?.industryKey);

  // Update settings
  await db.execute(sql`
    update tenant_settings
    set
      industry_key = ${nextIndustryKey}::text,
      updated_at = now()
    where tenant_id = ${tenantId}::uuid
  `);

  // Audit log (best-effort, no secrets)
  await db.execute(sql`
    insert into tenant_audit_log (
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
      ${tenantId}::uuid,
      'industry.confirmed_from_ai',
      null,
      null,
      null,
      'Confirmed industry from PCC (AI suggestion)',
      ${JSON.stringify({
        prevIndustryKey: prevIndustryKey || null,
        nextIndustryKey,
        source: "pcc",
      })}::jsonb,
      now()
    )
  `);

  return NextResponse.json(
    {
      ok: true,
      tenantId,
      prevIndustryKey: prevIndustryKey || null,
      nextIndustryKey,
    },
    { status: 200 }
  );
}