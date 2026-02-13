// src/app/api/onboarding/pricing/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenantSettings } from "@/lib/db/schema";

const PricingModelEnum = z.enum([
  "flat_per_job",
  "hourly_plus_materials",
  "per_unit",
  "packages",
  "line_items",
  "inspection_only",
  "assessment_fee",
]);

const GetSchema = z.object({
  tenantId: z.string().uuid(),
});

const PostSchema = z.object({
  tenantId: z.string().uuid(),
  pricingModel: PricingModelEnum.nullable().optional(),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = GetSchema.safeParse({ tenantId: url.searchParams.get("tenantId") });

    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "bad_request", issues: parsed.error.issues }, { status: 400 });
    }

    const { tenantId } = parsed.data;

    const rows = await db
      .select({ pricingModel: tenantSettings.pricingModel })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId))
      .limit(1);

    const pricingModel = (rows[0]?.pricingModel ?? null) as string | null;

    return NextResponse.json({ ok: true, tenantId, pricingModel });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "server_error", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = PostSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "bad_request", issues: parsed.error.issues }, { status: 400 });
    }

    const { tenantId, pricingModel } = parsed.data;

    const update: any = {
      updatedAt: new Date(),
    };

    // allow null to clear
    if (pricingModel === null) update.pricingModel = null;
    if (typeof pricingModel === "string") update.pricingModel = pricingModel;

    await db.update(tenantSettings).set(update).where(eq(tenantSettings.tenantId, tenantId));

    // return the value post-write
    const rows = await db
      .select({ pricingModel: tenantSettings.pricingModel })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId))
      .limit(1);

    return NextResponse.json({ ok: true, tenantId, pricingModel: rows[0]?.pricingModel ?? null });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "server_error", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}