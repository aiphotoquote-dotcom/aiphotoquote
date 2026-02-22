// src/app/api/pcc/industries/delete-derived/route.ts

import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  industryKey: z.string().min(1),
  reason: z.string().optional().nullable(),
});

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}
function safeLower(v: unknown) {
  return safeTrim(v).toLowerCase();
}
function actorFromReq(req: Request) {
  return (
    safeTrim(req.headers.get("x-clerk-user-id")) ||
    safeTrim(req.headers.get("x-user-id")) ||
    safeTrim(req.headers.get("x-forwarded-for")) ||
    "unknown"
  );
}
function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}
function jsonbString(v: any) {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Audit insert that tolerates schema drift:
 * - tries snake_case columns (source_key/target_key)
 * - then tries legacy drizzle-lowercased columns (sourcekey/targetkey)
 * - if both fail, we swallow (delete should still work)
 */
async function bestEffortAudit(
  tx: any,
  args: {
    action: string;
    sourceKey: string;
    targetKey: string | null;
    actor: string;
    reason: string | null;
    payload: any;
  }
) {
  const payloadJson = jsonbString(args.payload);

  // Attempt 1: snake_case
  try {
    await tx.execute(sql`
      insert into industry_change_log (action, source_key, target_key, actor, reason, payload)
      values (${args.action}, ${args.sourceKey}, ${args.targetKey}, ${args.actor}, ${args.reason}, ${payloadJson}::jsonb)
    `);
    return;
  } catch {
    // fall through
  }

  // Attempt 2: lowercased “sourcekey/targetkey” (unquoted identifiers)
  try {
    await tx.execute(sql`
      insert into industry_change_log (action, sourcekey, targetkey, actor, reason, payload)
      values (${args.action}, ${args.sourceKey}, ${args.targetKey}, ${args.actor}, ${args.reason}, ${payloadJson}::jsonb)
    `);
  } catch {
    // swallow
  }
}

export async function POST(req: Request) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, 400);
  }

  const industryKey = safeLower(parsed.data.industryKey);
  const reason = safeTrim(parsed.data.reason ?? "") || null;
  if (!industryKey) return json({ ok: false, error: "BAD_REQUEST", message: "industryKey is required" }, 400);

  const actor = actorFromReq(req);

  const result = await db.transaction(async (tx) => {
    // Ensure it's NOT canonical (derived-only endpoint)
    const indR = await tx.execute(sql`
      select 1 as "n"
      from industries
      where lower(key) = ${industryKey}
      limit 1
    `);
    const isCanonical = Boolean((indR as any)?.rows?.[0]?.n);
    if (isCanonical) {
      return {
        ok: false as const,
        status: 409,
        error: "IS_CANONICAL",
        message: "This is a canonical industry. Use /api/pcc/industries/delete instead.",
      };
    }

    // Block delete if ANY tenants are still assigned
    const tenantCountR = await tx.execute(sql`
      select count(*)::int as "n"
      from tenant_settings
      where lower(industry_key) = ${industryKey}
    `);
    const nTenants = Number((tenantCountR as any)?.rows?.[0]?.n ?? 0);
    if (nTenants > 0) {
      return {
        ok: false as const,
        status: 409,
        error: "HAS_TENANTS",
        message: `Cannot delete: ${nTenants} tenants still assigned.`,
      };
    }

    // Delete dependents (cleanup only; no suppression)
    const delIndustrySubR = await tx.execute(sql`
      delete from industry_sub_industries
      where lower(industry_key) = ${industryKey}
    `);

    const delPacksR = await tx.execute(sql`
      delete from industry_llm_packs
      where lower(industry_key) = ${industryKey}
    `);

    const payload = {
      industryKey,
      isCanonicalBefore: false,
      deleted: {
        industrySubIndustries: Number((delIndustrySubR as any)?.rowCount ?? 0),
        industryLlmPacks: Number((delPacksR as any)?.rowCount ?? 0),
        industriesRow: 0,
      },
    };

    await bestEffortAudit(tx, {
      action: "delete_derived",
      sourceKey: industryKey,
      targetKey: null,
      actor,
      reason,
      payload,
    });

    return {
      ok: true as const,
      industryKey,
      deleted: payload.deleted,
    };
  });

  if ((result as any)?.ok === false) {
    return json(
      { ok: false, error: (result as any).error, message: (result as any).message },
      (result as any).status ?? 400
    );
  }

  return json(result, 200);
}