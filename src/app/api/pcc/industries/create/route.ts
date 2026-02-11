// src/app/api/pcc/industries/create/route.ts

import { NextResponse, NextRequest } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  key: z.string().min(1),
  label: z.string().min(1).max(160),
  description: z.string().max(2000).nullable().optional(),
});

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function safeKey(v: any) {
  return safeTrim(v).toLowerCase();
}

function isReasonableIndustryKey(k: string) {
  return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(k);
}

export async function POST(req: NextRequest) {
  // ✅ OWNER ONLY
  await requirePlatformRole(["platform_owner"]);

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY" }, { status: 400 });
  }

  const key = safeKey(parsed.data.key);
  const label = safeTrim(parsed.data.label);
  const description = parsed.data.description === undefined ? null : (parsed.data.description ? safeTrim(parsed.data.description) : null);

  if (!key || !isReasonableIndustryKey(key)) {
    return NextResponse.json({ ok: false, error: "INVALID_INDUSTRY_KEY" }, { status: 400 });
  }

  // Upsert canonical row.
  // - If key exists: update label/description (label always updates; description updates when provided)
  // - If key does not exist: create it
  const r = await db.execute(sql`
    insert into industries (key, label, description, created_at)
    values (${key}, ${label}, ${description}, now())
    on conflict (key)
    do update set
      label = excluded.label,
      description = case
        when excluded.description is null then industries.description
        else excluded.description
      end
    returning
      id::text as "id",
      key::text as "key",
      label::text as "label",
      description::text as "description",
      created_at as "createdAt"
  `);

  const row = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

  return NextResponse.json({
    ok: true,
    industry: row
      ? {
          id: String(row.id ?? ""),
          key: String(row.key ?? key),
          label: String(row.label ?? label),
          description: row.description ? String(row.description) : null,
          createdAt: row.createdAt ?? null,
        }
      : { key, label, description },
  });
}