// src/app/api/onboarding/industries/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IndustryItem = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  source: "platform" | "tenant";
};

/* --------------------- utils --------------------- */

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function firstRow(r: any): any | null {
  if (!r) return null;
  if (Array.isArray(r)) return r[0] ?? null;
  if (Array.isArray(r.rows)) return r.rows[0] ?? null;
  if (typeof r === "object" && r && 0 in r) return (r as any)[0] ?? null;
  return null;
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

function toIndustryKey(raw: string) {
  const s = safeTrim(raw).toLowerCase();
  if (!s) return "";
  // allow snake/kebab from AI; normalize spaces -> underscores
  return s
    .replace(/&/g, "and")
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function titleFromKey(key: string) {
  const s = safeTrim(key).replace(/[-_]+/g, " ");
  if (!s) return "Industry";
  return s.replace(/\b\w/g, (m) => m.toUpperCase());
}

async function listIndustries(): Promise<IndustryItem[]> {
  const r = await db.execute(sql`
    select id, key, label, description
    from industries
    order by label asc
  `);

  const rows: any[] = Array.isArray((r as any)?.rows) ? (r as any).rows : Array.isArray(r) ? r : [];
  return rows.map((x) => ({
    id: String(x.id),
    key: String(x.key),
    label: String(x.label),
    description: x.description == null ? null : String(x.description),
    source: "platform",
  }));
}

async function getSuggestedIndustryKeyFromOnboarding(tenantId: string): Promise<string> {
  const r = await db.execute(sql`
    select ai_analysis
    from tenant_onboarding
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);
  const row = firstRow(r);
  const suggested = safeTrim(row?.ai_analysis?.suggestedIndustryKey);
  return toIndustryKey(suggested);
}

async function getSelectedIndustryKeyFromTenantSettings(tenantId: string): Promise<string> {
  const r = await db.execute(sql`
    select industry_key
    from tenant_settings
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);
  const row = firstRow(r);
  return toIndustryKey(row?.industry_key ?? "");
}

async function setTenantIndustryKey(tenantId: string, industryKey: string) {
  await db.execute(sql`
    insert into tenant_settings (tenant_id, industry_key, updated_at)
    values (${tenantId}::uuid, ${industryKey}, now())
    on conflict (tenant_id) do update
    set industry_key = excluded.industry_key,
        updated_at = now()
  `);
}

async function ensureIndustryExists(industryKey: string, label?: string | null): Promise<void> {
  const key = toIndustryKey(industryKey);
  if (!key) return;

  const exists = await db.execute(sql`
    select 1 as ok
    from industries
    where key = ${key}
    limit 1
  `);
  const row = firstRow(exists);
  if (row?.ok) return;

  const computedLabel = safeTrim(label) || titleFromKey(key);

  // Create a platform industry immediately so UX never blocks.
  await db.execute(sql`
    insert into industries (id, key, label, description)
    values (gen_random_uuid(), ${key}, ${computedLabel}, null)
    on conflict (key) do nothing
  `);
}

/* --------------------- schema --------------------- */

const GetQuerySchema = z.object({
  tenantId: z.string().min(1),
});

const PostBodySchema = z.object({
  tenantId: z.string().min(1),
  industryKey: z.string().optional(),
  industryLabel: z.string().optional(),
});

/* --------------------- handlers --------------------- */

export async function GET(req: Request) {
  try {
    const { clerkUserId } = await requireAuthed();

    const u = new URL(req.url);
    const parsed = GetQuerySchema.safeParse({ tenantId: u.searchParams.get("tenantId") });
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "BAD_REQUEST", message: "tenantId is required." }, { status: 400 });
    }

    const tenantId = safeTrim(parsed.data.tenantId);
    await requireMembership(clerkUserId, tenantId);

    // 1) Pull AI suggestion
    const suggestedKey = await getSuggestedIndustryKeyFromOnboarding(tenantId);

    // 2) If suggested doesn't exist yet, auto-create it (platform list)
    if (suggestedKey) {
      await ensureIndustryExists(suggestedKey, null);
    }

    // 3) Load platform industries (now includes suggested if it was missing)
    const industries = await listIndustries();

    // 4) Determine selectedKey:
    // - if tenant_settings already has a valid industry_key, keep it
    // - else if AI suggested exists, auto-select it AND persist it to tenant_settings
    // - else fall back to null (user will pick/create)
    const currentSelected = await getSelectedIndustryKeyFromTenantSettings(tenantId);
    const currentSelectedExists = currentSelected && industries.some((x) => x.key === currentSelected);

    let selectedKey: string | null = currentSelectedExists ? currentSelected : null;

    const suggestedExists = suggestedKey && industries.some((x) => x.key === suggestedKey);
    if (!selectedKey && suggestedExists) {
      selectedKey = suggestedKey;
      await setTenantIndustryKey(tenantId, suggestedKey);
    }

    return NextResponse.json(
      {
        ok: true,
        tenantId,
        selectedKey: selectedKey || null,
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
    const { clerkUserId } = await requireAuthed();

    const bodyRaw = await req.json().catch(() => null);
    const parsed = PostBodySchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "BAD_REQUEST", message: "Invalid request body." }, { status: 400 });
    }

    const tenantId = safeTrim(parsed.data.tenantId);
    const industryKeyRaw = safeTrim(parsed.data.industryKey);
    const industryLabelRaw = safeTrim(parsed.data.industryLabel);

    await requireMembership(clerkUserId, tenantId);

    // Create-new path (user typed label)
    if (industryLabelRaw) {
      let key = toIndustryKey(industryLabelRaw);
      if (!key) key = `industry_${Math.random().toString(16).slice(2, 8)}`;

      // ensure unique-ish (if key already exists, suffix)
      const exists = await db.execute(sql`
        select 1 as ok
        from industries
        where key = ${key}
        limit 1
      `);
      const row = firstRow(exists);
      if (row?.ok) key = `${key}_${Math.random().toString(16).slice(2, 6)}`;

      await ensureIndustryExists(key, industryLabelRaw);
      await setTenantIndustryKey(tenantId, key);

      const industries = await listIndustries();
      return NextResponse.json({ ok: true, tenantId, selectedKey: key, industries }, { status: 200 });
    }

    // Select-existing path
    const industryKey = toIndustryKey(industryKeyRaw);
    if (!industryKey) {
      return NextResponse.json(
        { ok: false, error: "BAD_REQUEST", message: "industryKey or industryLabel is required." },
        { status: 400 }
      );
    }

    // If user picked a key that doesn't exist (edge case), create it so we never block.
    await ensureIndustryExists(industryKey, null);
    await setTenantIndustryKey(tenantId, industryKey);

    const industries = await listIndustries();
    return NextResponse.json({ ok: true, tenantId, selectedKey: industryKey, industries }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}