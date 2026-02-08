// src/app/api/onboarding/industries/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* --------------------- types --------------------- */

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

// Normalize keys from AI or user into a stable snake_case key.
// NOTE: do NOT require it to start with a letter; keep permissive but safe.
function normalizeIndustryKey(raw: string) {
  const s = safeTrim(raw).toLowerCase();
  if (!s) return "";
  const key = s
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return key;
}

/* --------------------- db helpers --------------------- */

async function getSuggestedIndustryKey(tenantId: string): Promise<string> {
  const r = await db.execute(sql`
    select ai_analysis
    from tenant_onboarding
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);
  const row = firstRow(r);
  const ai = row?.ai_analysis ?? null;
  return normalizeIndustryKey(ai?.suggestedIndustryKey ?? "");
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

async function ensureIndustryExists(industryKeyRaw: string): Promise<string> {
  const key = normalizeIndustryKey(industryKeyRaw);
  if (!key) return "";

  const label = titleFromKey(key);

  // ✅ safe regardless of whether industries.id has a default
  await db.execute(sql`
    insert into industries (id, key, label, description)
    values (gen_random_uuid(), ${key}, ${label}, null)
    on conflict (key) do update
    set label = excluded.label
  `);

  return key;
}

async function upsertTenantIndustryKey(tenantId: string, industryKeyRaw: string): Promise<string> {
  const key = normalizeIndustryKey(industryKeyRaw);
  if (!key) return "";

  await db.execute(sql`
    insert into tenant_settings (tenant_id, industry_key, updated_at)
    values (${tenantId}::uuid, ${key}, now())
    on conflict (tenant_id) do update
    set industry_key = excluded.industry_key,
        updated_at = now()
  `);

  return key;
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

    // 1) Read suggested key from ai_analysis
    const suggestedKey = await getSuggestedIndustryKey(tenantId);

    // 2) Ensure it exists globally (your desired UX)
    let ensuredSuggestedKey = "";
    if (suggestedKey) {
      ensuredSuggestedKey = await ensureIndustryExists(suggestedKey);
    }

    // 3) Load list after ensure
    const industries = await listIndustries();

    // 4) Pick default selected key
    const selectedKey =
      (ensuredSuggestedKey && industries.some((x) => x.key === ensuredSuggestedKey) ? ensuredSuggestedKey : null) ??
      (industries[0]?.key ?? null);

    // 5) ✅ Persist selection into tenant_settings automatically (so UX can continue without extra click)
    if (selectedKey) {
      await upsertTenantIndustryKey(tenantId, selectedKey);
    }

    const selectedLabel =
      (selectedKey ? industries.find((x) => x.key === selectedKey)?.label ?? null : null) ?? null;

    return NextResponse.json({ ok: true, tenantId, selectedKey, selectedLabel, industries }, { status: 200 });
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

    const industryKeyRaw = safeTrim(parsed.data.industryKey);
    const industryLabelRaw = safeTrim(parsed.data.industryLabel);

    // Create-new path (tenant typed label)
    if (industryLabelRaw && !industryKeyRaw) {
      const key = normalizeIndustryKey(industryLabelRaw);
      if (!key) {
        return NextResponse.json(
          { ok: false, error: "BAD_REQUEST", message: "Industry label is invalid." },
          { status: 400 }
        );
      }

      // ✅ safe regardless of industries.id default
      await db.execute(sql`
        insert into industries (id, key, label, description)
        values (gen_random_uuid(), ${key}, ${industryLabelRaw}, null)
        on conflict (key) do update
        set label = excluded.label
      `);

      const savedKey = await upsertTenantIndustryKey(tenantId, key);
      return NextResponse.json({ ok: true, tenantId, selectedKey: savedKey }, { status: 200 });
    }

    // Select-existing path
    if (!industryKeyRaw) {
      return NextResponse.json(
        { ok: false, error: "INDUSTRY_REQUIRED", message: "Choose an industry." },
        { status: 400 }
      );
    }

    // Ensure key exists (safety) + normalize it
    const ensuredKey = await ensureIndustryExists(industryKeyRaw);
    if (!ensuredKey) {
      return NextResponse.json(
        { ok: false, error: "BAD_REQUEST", message: "Industry key is invalid." },
        { status: 400 }
      );
    }

    const savedKey = await upsertTenantIndustryKey(tenantId, ensuredKey);
    return NextResponse.json({ ok: true, tenantId, selectedKey: savedKey }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}