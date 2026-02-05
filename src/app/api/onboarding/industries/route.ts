// src/app/api/onboarding/industries/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------------- utils ---------------- */

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function firstRow(r: unknown): any | null {
  if (!r) return null;
  if (Array.isArray(r)) return r[0] ?? null;
  const rr = r as any;
  if (Array.isArray(rr?.rows)) return rr.rows[0] ?? null;
  if (typeof rr === "object" && rr && 0 in rr) return (rr as any)[0] ?? null;
  return null;
}

function toIndustryKey(raw: string) {
  return safeTrim(raw)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function labelFromKey(key: string) {
  return key.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ---------------- auth ---------------- */

async function requireAuthed() {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHENTICATED");
  return userId;
}

async function requireMembership(clerkUserId: string, tenantId: string) {
  const r = await db.execute(sql`
    select 1 as ok
    from tenant_members
    where tenant_id = ${tenantId}::uuid
      and clerk_user_id = ${clerkUserId}
    limit 1
  `);
  const row = firstRow(r);
  if (!row?.ok) throw new Error("FORBIDDEN_TENANT");
}

/* ---------------- db helpers ---------------- */

type IndustryRow = {
  id: string;
  key: string;
  label: string;
  description: string | null;
};

async function ensureIndustryExists(key: string, label?: string | null) {
  const industryKey = toIndustryKey(key);
  if (!industryKey) return;

  const exists = await db.execute(sql`
    select 1 as ok
    from industries
    where key = ${industryKey}
    limit 1
  `);

  if (firstRow(exists)?.ok) return;

  await db.execute(sql`
    insert into industries (key, label, description)
    values (${industryKey}, ${label ?? labelFromKey(industryKey)}, null)
    on conflict (key) do nothing
  `);
}

async function listIndustries(): Promise<IndustryRow[]> {
  const r = await db.execute(sql`
    select id, key, label, description
    from industries
    order by label asc
  `);

  const rr = r as any;
  const rows: unknown[] = Array.isArray(rr?.rows) ? rr.rows : Array.isArray(r) ? (r as any[]) : [];

  return rows.map((x: unknown) => {
    const row = x as any;
    return {
      id: String(row?.id ?? ""),
      key: String(row?.key ?? ""),
      label: String(row?.label ?? ""),
      description: row?.description ? String(row.description) : null,
    };
  });
}

async function getSuggestedIndustryKey(tenantId: string): Promise<string> {
  const r = await db.execute(sql`
    select ai_analysis
    from tenant_onboarding
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);
  const row = firstRow(r);
  return toIndustryKey(row?.ai_analysis?.suggestedIndustryKey ?? "");
}

async function setTenantIndustry(tenantId: string, key: string) {
  await db.execute(sql`
    insert into tenant_settings (tenant_id, industry_key, updated_at)
    values (${tenantId}::uuid, ${key}, now())
    on conflict (tenant_id) do update
    set industry_key = excluded.industry_key,
        updated_at = now()
  `);
}

/* ---------------- schema ---------------- */

const GetSchema = z.object({
  tenantId: z.string().min(1),
});

const PostSchema = z.object({
  tenantId: z.string().min(1),
  industryKey: z.string().optional(),
  industryLabel: z.string().optional(),
});

/* ---------------- handlers ---------------- */

export async function GET(req: Request) {
  try {
    const clerkUserId = await requireAuthed();

    const u = new URL(req.url);
    const parsed = GetSchema.safeParse({ tenantId: u.searchParams.get("tenantId") });
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "TENANT_ID_REQUIRED" }, { status: 400 });
    }

    const tenantId = parsed.data.tenantId;
    await requireMembership(clerkUserId, tenantId);

    // Auto-accept AI suggestion (best UX)
    const suggestedKey = await getSuggestedIndustryKey(tenantId);
    if (suggestedKey) {
      await ensureIndustryExists(suggestedKey, null);
      await setTenantIndustry(tenantId, suggestedKey);
    }

    const industries = await listIndustries();

    return NextResponse.json(
      {
        ok: true,
        tenantId,
        selectedKey: suggestedKey || null,
        industries,
      },
      { status: 200 }
    );
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const clerkUserId = await requireAuthed();

    const body = await req.json().catch(() => null);
    const parsed = PostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "BAD_REQUEST" }, { status: 400 });
    }

    const { tenantId, industryKey, industryLabel } = parsed.data;
    await requireMembership(clerkUserId, tenantId);

    if (industryLabel) {
      const key = toIndustryKey(industryLabel);
      if (!key) return NextResponse.json({ ok: false, error: "BAD_INDUSTRY_LABEL" }, { status: 400 });
      await ensureIndustryExists(key, industryLabel);
      await setTenantIndustry(tenantId, key);
    } else if (industryKey) {
      const key = toIndustryKey(industryKey);
      if (!key) return NextResponse.json({ ok: false, error: "BAD_INDUSTRY_KEY" }, { status: 400 });
      await ensureIndustryExists(key, null);
      await setTenantIndustry(tenantId, key);
    } else {
      return NextResponse.json({ ok: false, error: "NO_INDUSTRY" }, { status: 400 });
    }

    const industries = await listIndustries();

    return NextResponse.json(
      {
        ok: true,
        tenantId,
        industries,
      },
      { status: 200 }
    );
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}