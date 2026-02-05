// src/app/api/onboarding/industries/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* --------------------- types --------------------- */

type IndustryRow = {
  id: string;
  key: string;
  label: string;
  description: string | null;
};

type ApiIndustryItem = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  source: "platform";
};

/* --------------------- utils --------------------- */

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function firstRow(r: any): any | null {
  if (!r) return null;
  if (Array.isArray(r)) return r[0] ?? null;
  if (Array.isArray((r as any).rows)) return (r as any).rows[0] ?? null;
  return null;
}

function rowsOf(r: any): any[] {
  if (!r) return [];
  if (Array.isArray(r)) return r;
  if (Array.isArray((r as any).rows)) return (r as any).rows;
  return [];
}

async function requireAuthed(): Promise<{ clerkUserId: string }> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHENTICATED");
  return { clerkUserId: userId };
}

async function requireMembership(clerkUserId: string, tenantId: string): Promise<void> {
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

function titleFromKey(key: string) {
  const s = safeTrim(key).replace(/[-_]+/g, " ").trim();
  if (!s) return "Service";
  return s
    .split(" ")
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(" ");
}

async function getSuggestedIndustryKey(tenantId: string): Promise<string> {
  const r = await db.execute(sql`
    select ai_analysis
    from tenant_onboarding
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);
  const row = firstRow(r);
  const ai = row?.ai_analysis ?? null;
  return safeTrim(ai?.suggestedIndustryKey ?? "");
}

async function listIndustries(): Promise<ApiIndustryItem[]> {
  const r = await db.execute(sql`
    select id, key, label, description
    from industries
    order by label asc
  `);

  const rows = rowsOf(r) as any[];

  return rows.map((x: any) => ({
    id: String(x.id),
    key: String(x.key),
    label: String(x.label),
    description: x.description == null ? null : String(x.description),
    source: "platform" as const,
  }));
}

async function ensureIndustryExists(industryKey: string): Promise<void> {
  const key = safeTrim(industryKey);
  if (!key) return;

  const label = titleFromKey(key);

  await db.execute(sql`
    insert into industries (key, label, description)
    values (${key}, ${label}, null)
    on conflict (key) do nothing
  `);
}

/* --------------------- schema --------------------- */

const GetSchema = z.object({
  tenantId: z.string().min(1),
});

const PostSchema = z.object({
  tenantId: z.string().min(1),
  industryKey: z.string().optional(),
  industryLabel: z.string().optional(),
});

/* --------------------- handlers --------------------- */

export async function GET(req: Request) {
  try {
    const { clerkUserId } = await requireAuthed();

    const u = new URL(req.url);
    const parsed = GetSchema.safeParse({ tenantId: u.searchParams.get("tenantId") });
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "BAD_REQUEST", message: "tenantId is required." }, { status: 400 });
    }

    const tenantId = parsed.data.tenantId;
    await requireMembership(clerkUserId, tenantId);

    // 1) Get AI suggestion
    const suggestedKey = await getSuggestedIndustryKey(tenantId);

    // 2) Auto-create if missing (this is your desired UX)
    if (suggestedKey) {
      await ensureIndustryExists(suggestedKey);
    }

    // 3) Return list
    const industries = await listIndustries();

    // 4) Pick default selected key
    const selectedKey =
      (suggestedKey && industries.some((x) => x.key === suggestedKey) ? suggestedKey : null) ??
      (industries[0]?.key ?? null);

    return NextResponse.json({ ok: true, tenantId, selectedKey, industries }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const { clerkUserId } = await requireAuthed();

    const bodyRaw = await req.json().catch(() => null);
    const parsed = PostSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "BAD_REQUEST", message: "Invalid request body." }, { status: 400 });
    }

    const tenantId = safeTrim(parsed.data.tenantId);
    await requireMembership(clerkUserId, tenantId);

    const industryKey = safeTrim(parsed.data.industryKey);
    const industryLabel = safeTrim(parsed.data.industryLabel);

    // Create-new path (tenant typed label)
    if (industryLabel && !industryKey) {
      const key = industryLabel
        .toLowerCase()
        .replace(/&/g, "and")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 64);

      await db.execute(sql`
        insert into industries (key, label, description)
        values (${key}, ${industryLabel}, null)
        on conflict (key) do update
        set label = excluded.label
      `);

      await db.execute(sql`
        update tenant_settings
        set industry_key = ${key},
            updated_at = now()
        where tenant_id = ${tenantId}::uuid
      `);

      return NextResponse.json({ ok: true, tenantId, selectedKey: key }, { status: 200 });
    }

    // Select-existing path
    if (!industryKey) {
      return NextResponse.json({ ok: false, error: "INDUSTRY_REQUIRED", message: "Choose an industry." }, { status: 400 });
    }

    // Ensure key exists (safety)
    await ensureIndustryExists(industryKey);

    await db.execute(sql`
      update tenant_settings
      set industry_key = ${industryKey},
          updated_at = now()
      where tenant_id = ${tenantId}::uuid
    `);

    return NextResponse.json({ ok: true, tenantId, selectedKey: industryKey }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}