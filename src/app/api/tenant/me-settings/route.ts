// src/app/api/tenant/me-settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";

import { db } from "../../../../lib/db/client";
import { tenants } from "../../../../lib/db/schema";

export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const tenantRows = await db
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.ownerClerkUserId, userId))
      .limit(1);

    const tenant = tenantRows[0];
    if (!tenant?.id) {
      return NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND" }, { status: 404 });
    }

    const settingsRows = await db.execute(sql`
      select
        "tenant_id",
        "industry_key",
        "redirect_url",
        "thank_you_url",
        "updated_at"
      from "tenant_settings"
      where "tenant_id" = ${tenant.id}::uuid
      limit 1
    `);

    const settings = ((settingsRows as any)?.[0] ?? null) as
      | {
          tenant_id: string;
          industry_key: string | null;
          redirect_url: string | null;
          thank_you_url: string | null;
          updated_at: string | null;
        }
      | null;

    // ✅ New: detect whether an OpenAI key exists (without returning it)
    const secretsRows = await db.execute(sql`
      select 1 as "has"
      from "tenant_secrets"
      where "tenant_id" = ${tenant.id}::uuid
      limit 1
    `);

    const hasOpenaiKey = Boolean((secretsRows as any)?.[0]?.has);

    return NextResponse.json({
      ok: true,
      tenant,
      settings,
      secrets: { hasOpenaiKey },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL", message: err?.message || String(err) } },
      { status: 500 }
    );
  }
}
