// src/app/api/onboarding/ensure-industry-pack/route.ts

import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { generateIndustryPack } from "@/lib/pcc/industries/packGenerator";

// NOTE: Use the same auth guard pattern as your other onboarding routes.
// If your onboarding routes use tenant-member auth, copy/paste that here.
// If they are platform-only, swap this for requirePlatformRole.
import { requireTenantAccessFromReq } from "@/lib/rbac/guards"; // <-- replace with your real onboarding guard

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tenantId: z.string().uuid(),
  industryKey: z.string().min(1),
  industryLabel: z.string().optional().nullable(),
  industryDescription: z.string().optional().nullable(),
  force: z.boolean().optional(), // if true, generate even if one exists
});

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function normalizeIndustryKey(v: unknown) {
  const s = safeTrim(v).toLowerCase();
  // normalize spaces/hyphens to underscore, collapse repeats
  return s
    .replace(/[\s\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function titleFromKey(key: string) {
  return key
    .split(/[_\-]+/g)
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(" ");
}

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

export async function POST(req: Request) {
  // ✅ IMPORTANT: match your onboarding auth model
  // Replace this with whatever your onboarding routes use today.
  await requireTenantAccessFromReq(req);

  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, 400);
  }

  const tenantId = parsed.data.tenantId;
  const industryKey = normalizeIndustryKey(parsed.data.industryKey);
  const force = Boolean(parsed.data.force);

  if (!industryKey) return json({ ok: false, error: "BAD_REQUEST", message: "industryKey is required" }, 400);

  // label/description fallbacks
  const industryLabel = safeTrim(parsed.data.industryLabel) || titleFromKey(industryKey);
  const industryDescription = safeTrim(parsed.data.industryDescription) || null;

  const result = await db.transaction(async (tx) => {
    // 1) Does an enabled pack already exist?
    const existingR = await tx.execute(sql`
      select
        version::int as "version",
        updated_at as "updatedAt"
      from industry_llm_packs
      where lower(industry_key) = ${industryKey}
        and enabled = true
      order by version desc, updated_at desc
      limit 1
    `);
    const existing = (existingR as any)?.rows?.[0] ?? null;

    if (existing && !force) {
      return {
        ok: true as const,
        industryKey,
        status: "exists" as const,
        version: Number(existing.version ?? 0),
      };
    }

    // 2) Determine next version
    const maxVR = await tx.execute(sql`
      select coalesce(max(version), 0)::int as "v"
      from industry_llm_packs
      where lower(industry_key) = ${industryKey}
    `);
    const maxV = Number((maxVR as any)?.rows?.[0]?.v ?? 0);
    const nextV = maxV + 1;

    // 3) Generate pack using the SAME engine PCC uses
    const packResult = await generateIndustryPack({
      tenantId,
      industryKey,
      industryLabel,
      industryDescription,
    });

    // packResult is whatever your generator returns (pack/models/prompts/etc).
    // We store it in DB exactly like PCC does.
    await tx.execute(sql`
      insert into industry_llm_packs (id, industry_key, enabled, version, pack, models, prompts, updated_at)
      values (
        gen_random_uuid(),
        ${industryKey},
        true,
        ${nextV}::int,
        ${JSON.stringify((packResult as any).pack ?? (packResult as any))}::jsonb,
        ${JSON.stringify((packResult as any).models ?? {})}::jsonb,
        ${JSON.stringify((packResult as any).prompts ?? {})}::jsonb,
        now()
      )
    `);

    return {
      ok: true as const,
      industryKey,
      status: existing ? ("regenerated" as const) : ("created" as const),
      version: nextV,
    };
  });

  return json(result, 200);
}