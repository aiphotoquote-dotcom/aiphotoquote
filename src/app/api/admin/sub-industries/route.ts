// src/app/api/admin/sub-industries/route.ts
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { tenantSettings, tenantSubIndustries } from "@/lib/db/schema";
import { requireTenantRole } from "@/lib/auth/tenant";
import { mergeSubIndustries, normalizeKey } from "@/lib/industry/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      pragma: "no-cache",
      expires: "0",
    },
  });
}

const PostBody = z.object({
  key: z.string().min(1),
  label: z.string().min(1).optional(),
});

export async function GET() {
  const gate = await requireTenantRole(["owner", "admin", "member"]);
  if (!gate.ok) return json({ ok: false, error: gate.error, message: gate.message }, gate.status);

  try {
    const settings = await db
      .select({ industryKey: tenantSettings.industryKey })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, gate.tenantId as any))
      .limit(1)
      .then((r) => r[0] ?? null);

    const rows = await db
      .select({ key: tenantSubIndustries.key, label: tenantSubIndustries.label })
      .from(tenantSubIndustries)
      .where(eq(tenantSubIndustries.tenantId, gate.tenantId as any));

    const tenantCustom = rows.map((r) => ({ key: r.key, label: r.label }));
    const merged = mergeSubIndustries(settings?.industryKey ?? null, tenantCustom);

    return json({
      ok: true,
      industry_key: settings?.industryKey ?? null,
      sub_industries: merged,
      tenant_custom: tenantCustom,
    });
  } catch (e: any) {
    return json({ ok: false, error: "INTERNAL", message: e?.message ?? String(e) }, 500);
  }
}

export async function POST(req: Request) {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) return json({ ok: false, error: gate.error, message: gate.message }, gate.status);

  try {
    const bodyJson = await req.json().catch(() => null);
    const parsed = PostBody.safeParse(bodyJson);
    if (!parsed.success) return json({ ok: false, error: "INVALID_BODY", issues: parsed.error.issues }, 400);

    const key = normalizeKey(parsed.data.key);
    const label = String(parsed.data.label ?? parsed.data.key).trim();
    if (!key) return json({ ok: false, error: "INVALID_KEY" }, 400);

    // NOTE: If tenantSubIndustries.id does NOT exist in prod, this insert will fail.
    // If you're not 100% sure id exists, we should remove it and rely on (tenant_id, key) PK/unique.
    await db
      .insert(tenantSubIndustries)
      .values({
        id: crypto.randomUUID(),
        tenantId: gate.tenantId as any,
        key,
        label,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [tenantSubIndustries.tenantId, tenantSubIndustries.key],
        set: { label, updatedAt: new Date() },
      });

    return json({ ok: true, key, label });
  } catch (e: any) {
    // If you see "column id does not exist" here, tell me and we'll remove id from .values().
    return json({ ok: false, error: "INTERNAL", message: e?.message ?? String(e) }, 500);
  }
}