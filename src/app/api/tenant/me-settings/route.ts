// src/app/api/tenant/me-settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";

import { db } from "../../../../lib/db/client";
import { tenants } from "../../../../lib/db/schema";

export const runtime = "nodejs";

type ProbeResult =
  | { ok: true; step: string }
  | { ok: false; step: string; message: string };

async function probe(step: string, q: any): Promise<ProbeResult> {
  try {
    await db.execute(q);
    return { ok: true, step };
  } catch (err: any) {
    return { ok: false, step, message: err?.message ?? String(err) };
  }
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const tenantRows = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.ownerClerkUserId, userId))
      .limit(1);

    const tenant = tenantRows[0];
    if (!tenant?.id) {
      return NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND" }, { status: 404 });
    }

    const url = new URL(req.url);
    const debug = url.searchParams.get("debug") === "1";
    if (!debug) {
      return NextResponse.json(
        { ok: false, error: "Add ?debug=1 temporarily" },
        { status: 400 }
      );
    }

    const tid = tenant.id;

    const results: ProbeResult[] = [];
    // Baseline: table + where works?
    results.push(
      await probe(
        "select tenant_id only",
        sql`select "tenant_id" from "tenant_settings" where "tenant_id" = ${tid}::uuid limit 1`
      )
    );

    // Now add columns one by one (these match the failing query)
    results.push(
      await probe(
        "select id + tenant_id",
        sql`select "id","tenant_id" from "tenant_settings" where "tenant_id" = ${tid}::uuid limit 1`
      )
    );

    results.push(
      await probe(
        "add industry_key",
        sql`select "id","tenant_id","industry_key" from "tenant_settings" where "tenant_id" = ${tid}::uuid limit 1`
      )
    );

    results.push(
      await probe(
        "add redirect_url",
        sql`select "id","tenant_id","industry_key","redirect_url" from "tenant_settings" where "tenant_id" = ${tid}::uuid limit 1`
      )
    );

    results.push(
      await probe(
        "add thank_you_url",
        sql`select "id","tenant_id","industry_key","redirect_url","thank_you_url" from "tenant_settings" where "tenant_id" = ${tid}::uuid limit 1`
      )
    );

    results.push(
      await probe(
        "add created_at",
        sql`select "id","tenant_id","industry_key","redirect_url","thank_you_url","created_at" from "tenant_settings" where "tenant_id" = ${tid}::uuid limit 1`
      )
    );

    return NextResponse.json({
      ok: true,
      tenant_id: tid,
      probe: results,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL", message: err?.message || String(err) } },
      { status: 500 }
    );
  }
}
