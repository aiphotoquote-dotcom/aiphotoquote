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
  label: z.string().optional().nullable(),
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
    "platform"
  );
}

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

function jsonbString(v: any) {
  if (v === undefined || v === null) return "{}";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return "{}";
  }
}

async function auditCanonicalize(tx: any, args: { industryKey: string; actor: string; reason: string | null; snapshot: any }) {
  const snapshotJson = jsonbString(args.snapshot);

  // ✅ IMPORTANT: your real table columns are source_industry_key/target_industry_key/snapshot
  await tx.execute(sql`
    insert into industry_change_log (action, source_industry_key, target_industry_key, actor, reason, snapshot)
    values ('canonicalize', ${args.industryKey}, null, ${args.actor}, ${args.reason}, ${snapshotJson}::jsonb)
  `);
}

export async function POST(req: Request) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support", "platform_billing"]);

  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, 400);
  }

  const industryKey = safeLower(parsed.data.industryKey);
  const labelIn = safeTrim(parsed.data.label ?? "");
  const descriptionIn = safeTrim(parsed.data.description ?? "") || null;
  const reason = safeTrim(parsed.data.reason ?? "") || null;

  if (!industryKey) return json({ ok: false, error: "BAD_REQUEST", message: "industryKey is required" }, 400);

  const actor = actorFromReq(req);

  const result = await db.transaction(async (tx) => {
    // Is it already canonical?
    const existingR = await tx.execute(sql`
      select id::text as "id", key::text as "key", label::text as "label", description::text as "description"
      from industries
      where lower(key) = ${industryKey}
      limit 1
    `);

    const existing = (existingR as any)?.rows?.[0] ?? null;

    if (existing) {
      const snapshot = {
        mode: "canonicalize",
        industry: {
          key: safeLower(existing.key),
          label: String(existing.label ?? ""),
          description: existing.description ? String(existing.description) : null,
        },
        alreadyCanonical: true,
      };

      await auditCanonicalize(tx, { industryKey, actor, reason, snapshot });

      return {
        ok: true as const,
        industryKey,
        alreadyCanonical: true,
        industry: snapshot.industry,
      };
    }

    // Need a label to create a canonical row. If UI didn’t supply one, use the key.
    const label = labelIn || industryKey;

    const insertedR = await tx.execute(sql`
      insert into industries (id, key, label, description, created_at)
      values (gen_random_uuid(), ${industryKey}, ${label}, ${descriptionIn}, now())
      returning key::text as "key", label::text as "label", description::text as "description"
    `);

    const inserted = (insertedR as any)?.rows?.[0] ?? null;

    const snapshot = {
      mode: "canonicalize",
      industry: {
        key: safeLower(inserted?.key ?? industryKey),
        label: String(inserted?.label ?? label),
        description: inserted?.description ? String(inserted.description) : descriptionIn,
      },
      alreadyCanonical: false,
    };

    await auditCanonicalize(tx, { industryKey, actor, reason, snapshot });

    return {
      ok: true as const,
      industryKey,
      alreadyCanonical: false,
      industry: snapshot.industry,
    };
  });

  return json(result, 200);
}