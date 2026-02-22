// src/app/api/pcc/industries/options/route.ts

import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().optional(),
});

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}
function safeLower(v: unknown) {
  return safeTrim(v).toLowerCase();
}

function titleFromKey(key: string) {
  return safeTrim(key)
    .split("_")
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(" ");
}

export async function GET(req: Request) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

  const url = new URL(req.url);
  const parsed = Query.safeParse({
    q: url.searchParams.get("q") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, { status: 400 });
  }

  const q = safeTrim(parsed.data.q ?? "");
  const limit = Math.max(10, Math.min(500, Number(parsed.data.limit ?? 200)));
  const like = q ? `%${q.toLowerCase()}%` : null;

  const r = await db.execute(sql`
    with
      tenant_counts as (
        select lower(ts.industry_key)::text as "key", count(*)::int as "tenantCount"
        from tenant_settings ts
        group by lower(ts.industry_key)
      ),
      candidates as (
        -- canonical industries (label from table)
        select
          lower(i.key)::text as "key",
          i.label::text as "label",
          true as "isCanonical"
        from industries i
        where ${like} is null
           or lower(i.key) like ${like}
           or lower(coalesce(i.label,'')) like ${like}

        union

        -- derived keys observed anywhere
        select distinct lower(ts.industry_key)::text as "key", null::text as "label", false as "isCanonical"
        from tenant_settings ts
        where ${like} is null or lower(ts.industry_key) like ${like}

        union

        select distinct lower(p.industry_key)::text as "key", null::text as "label", false as "isCanonical"
        from industry_llm_packs p
        where ${like} is null or lower(p.industry_key) like ${like}

        union

        select distinct lower(s.industry_key)::text as "key", null::text as "label", false as "isCanonical"
        from industry_sub_industries s
        where ${like} is null or lower(s.industry_key) like ${like}

        union

        select distinct lower(tsi.industry_key)::text as "key", null::text as "label", false as "isCanonical"
        from tenant_sub_industries tsi
        where ${like} is null or lower(tsi.industry_key) like ${like}
      )
    select
      c."key"::text as "key",
      max(c."label")::text as "label",
      bool_or(c."isCanonical") as "isCanonical",
      coalesce(tc."tenantCount", 0)::int as "tenantCount"
    from candidates c
    left join tenant_counts tc on tc."key" = c."key"
    group by c."key", tc."tenantCount"
    order by
      bool_or(c."isCanonical") desc,
      coalesce(tc."tenantCount", 0) desc,
      c."key" asc
    limit ${limit}::int
  `);

  const rows = (r as any)?.rows ?? [];

  const options = rows
    .map((x: any) => {
      const key = safeLower(x.key);
      if (!key) return null;

      const label = safeTrim(x.label) || titleFromKey(key);
      return {
        key,
        label,
        isCanonical: Boolean(x.isCanonical),
        tenantCount: Number(x.tenantCount ?? 0),
      };
    })
    .filter(Boolean);

  return NextResponse.json({ ok: true, options }, { status: 200 });
}