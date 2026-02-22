// src/app/api/pcc/industries/canonicalize/route.ts

import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  industryKey: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional().nullable(),
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

export async function POST(req: Request) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, 400);
  }

  const industryKey = safeLower(parsed.data.industryKey);
  const label = safeTrim(parsed.data.label);
  const description = safeTrim(parsed.data.description ?? "") || null;
  const reason = safeTrim(parsed.data.reason ?? "") || null;

  if (!industryKey || !label) return json({ ok: false, error: "BAD_REQUEST", message: "Missing key/label" }, 400);

  const actor = actorFromReq(req);

  const result = await db.transaction(async (tx) => {
    const existsR = await tx.execute(sql`
      select 1 as "x"
      from industries
      where key = ${industryKey}
      limit 1
    `);
    const exists = Boolean((existsR as any)?.rows?.[0]?.x);
    if (exists) {
      return { ok: false as const, status: 409, error: "ALREADY_CANONICAL" };
    }

    const insR = await tx.execute(sql`
      insert into industries (id, key, label, description, created_at)
      values (gen_random_uuid(), ${industryKey}, ${label}, ${description}, now())
    `);

    const payload = {
      industry: { key: industryKey, label, description },
    };

    await tx.execute(sql`
      insert into industry_change_log (action, source_key, target_key, actor, reason, payload)
      values ('canonicalize', ${industryKey}, null, ${actor}, ${reason}, ${jsonbString(payload)}::jsonb)
    `);

    return { ok: true as const, industryKey };
  });

  if ((result as any)?.ok === false) {
    return json({ ok: false, error: (result as any).error }, (result as any).status ?? 400);
  }

  return json(result, 200);
}