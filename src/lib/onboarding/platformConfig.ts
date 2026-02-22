\\ src/lib/onboarding/ensureIndustryPack.ts


import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { generateIndustryPack } from "@/lib/pcc/industries/packGenerator";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

export async function ensureIndustryPack(args: {
  tenantId: string;
  industryKey: string;
  industryLabel: string;
  industryDescription?: string | null;
  force?: boolean;
}) {
  const tenantId = safeTrim(args.tenantId);
  const industryKey = safeTrim(args.industryKey);
  const industryLabel = safeTrim(args.industryLabel);
  const industryDescription = args.industryDescription == null ? null : String(args.industryDescription);
  const force = Boolean(args.force);

  if (!tenantId) throw new Error("TENANT_ID_REQUIRED");
  if (!industryKey) throw new Error("INDUSTRY_KEY_REQUIRED");

  return await db.transaction(async (tx) => {
    const existingR = await tx.execute(sql`
      select version::int as "version"
      from industry_llm_packs
      where lower(industry_key) = lower(${industryKey})
        and enabled = true
      order by version desc, updated_at desc
      limit 1
    `);
    const existing = (existingR as any)?.rows?.[0] ?? null;

    if (existing && !force) {
      return { status: "exists" as const, version: Number(existing.version ?? 0) };
    }

    const maxVR = await tx.execute(sql`
      select coalesce(max(version), 0)::int as "v"
      from industry_llm_packs
      where lower(industry_key) = lower(${industryKey})
    `);
    const maxV = Number((maxVR as any)?.rows?.[0]?.v ?? 0);
    const nextV = maxV + 1;

    const packResult = await generateIndustryPack({
      tenantId,
      industryKey,
      industryLabel,
      industryDescription,
    });

    // store like PCC does
    await tx.execute(sql`
      insert into industry_llm_packs (id, industry_key, enabled, version, pack, models, prompts, updated_at)
      values (
        gen_random_uuid(),
        ${industryKey},
        true,
        ${nextV}::int,
        ${JSON.stringify((packResult as any).pack ?? packResult)}::jsonb,
        ${JSON.stringify((packResult as any).models ?? {})}::jsonb,
        ${JSON.stringify((packResult as any).prompts ?? {})}::jsonb,
        now()
      )
    `);

    return { status: existing ? ("regenerated" as const) : ("created" as const), version: nextV };
  });
}