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

type ApiSubIndustryItem = {
  id: string;
  key: string;
  label: string;
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
      and status = 'active'
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
function normalizeKey(raw: string) {
  const s = safeTrim(raw).toLowerCase();
  if (!s) return "";
  return s
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

/**
 * Try to discover any sub-industry label hint from ai_analysis without hard-coding a single shape.
 * (We can tighten this later when you lock the ai_analysis schema.)
 */
function getSuggestedSubIndustryLabel(ai: any): string {
  if (!ai || typeof ai !== "object") return "";

  const direct =
    safeTrim((ai as any).suggestedSubIndustryLabel) ||
    safeTrim((ai as any).subIndustryLabel) ||
    safeTrim((ai as any).subIndustryGuess);

  if (direct) return direct;

  const inf = (ai as any).industryInference;
  if (inf && typeof inf === "object") {
    return (
      safeTrim((inf as any).suggestedSubIndustryLabel) ||
      safeTrim((inf as any).subIndustryLabel) ||
      safeTrim((inf as any).subIndustryGuess)
    );
  }

  return "";
}

/* --------------------- db helpers --------------------- */

async function readTenantSelection(tenantId: string): Promise<string> {
  const r = await db.execute(sql`
    select industry_key
    from tenant_settings
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);
  const row = firstRow(r);
  return normalizeKey(row?.industry_key ?? "");
}

async function getSuggestedIndustryKeyFromAi(tenantId: string): Promise<string> {
  const r = await db.execute(sql`
    select ai_analysis
    from tenant_onboarding
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);
  const row = firstRow(r);
  const ai = row?.ai_analysis ?? null;
  return normalizeKey(ai?.suggestedIndustryKey ?? "");
}

async function getSuggestedSubIndustryLabelFromAi(tenantId: string): Promise<string> {
  const r = await db.execute(sql`
    select ai_analysis
    from tenant_onboarding
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);
  const row = firstRow(r);
  const ai = row?.ai_analysis ?? null;
  return getSuggestedSubIndustryLabel(ai);
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

async function ensureIndustryExists(industryKeyOrLabelRaw: string, explicitLabel?: string): Promise<string> {
  const key = normalizeKey(industryKeyOrLabelRaw);
  if (!key) return "";

  const label = safeTrim(explicitLabel) || titleFromKey(key);

  // ✅ create if missing; keep label fresh
  await db.execute(sql`
    insert into industries (id, key, label, description)
    values (gen_random_uuid(), ${key}, ${label}, null)
    on conflict (key) do update
      set label = excluded.label
  `);

  return key;
}

async function upsertTenantIndustryKey(tenantId: string, industryKeyRaw: string): Promise<string> {
  const key = normalizeKey(industryKeyRaw);
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

async function listTenantSubIndustries(tenantId: string): Promise<ApiSubIndustryItem[]> {
  // NOTE: your tenant_sub_industries sample shows: id, tenant_id, key, label, updated_at
  const r = await db.execute(sql`
    select id, key, label
    from tenant_sub_industries
    where tenant_id = ${tenantId}::uuid
    order by label asc
  `);

  return rowsOf(r).map((x: any) => ({
    id: String(x.id),
    key: String(x.key),
    label: String(x.label),
  }));
}

async function upsertTenantSubIndustry(args: { tenantId: string; label?: string; key?: string }): Promise<string> {
  const label = safeTrim(args.label);
  const key = normalizeKey(args.key || label);

  if (!label || !key) return "";

  // We assume a uniqueness constraint like (tenant_id, key).
  // If yours differs, we can adjust after you paste schema.
  await db.execute(sql`
    insert into tenant_sub_industries (id, tenant_id, key, label, updated_at)
    values (gen_random_uuid(), ${args.tenantId}::uuid, ${key}, ${label}, now())
    on conflict (tenant_id, key) do update
      set label = excluded.label,
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

  // Industry selection (existing behavior)
  industryKey: z.string().optional(),
  industryLabel: z.string().optional(),

  // ✅ Sub-industry: allow onboarding to create/select without pre-pop
  subIndustryKey: z.string().optional(),
  subIndustryLabel: z.string().optional(),
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

    // 1) Read current saved selection (do NOT mutate on GET)
    const savedKey = await readTenantSelection(tenantId);

    // 2) Read AI suggested key and ensure it exists globally (so dropdown can show it)
    const suggestedKey = await getSuggestedIndustryKeyFromAi(tenantId);
    let ensuredSuggestedKey = "";
    if (suggestedKey) ensuredSuggestedKey = await ensureIndustryExists(suggestedKey);

    // 3) Load industries after ensure
    const industries = await listIndustries();

    // 4) Decide "selectedKey" for UI default (still not persisted unless POST)
    const selectedKey =
      (savedKey && industries.some((x) => x.key === savedKey) ? savedKey : "") ||
      (ensuredSuggestedKey && industries.some((x) => x.key === ensuredSuggestedKey) ? ensuredSuggestedKey : "") ||
      (industries[0]?.key ?? "");

    const selectedLabel = selectedKey ? industries.find((x) => x.key === selectedKey)?.label ?? null : null;

    // 5) Sub-industries (tenant scoped)
    const subIndustries = await listTenantSubIndustries(tenantId);

    // Optional AI hint (don’t auto-create on GET — just return hint)
    const suggestedSubIndustryLabel = await getSuggestedSubIndustryLabelFromAi(tenantId);

    return NextResponse.json(
      {
        ok: true,
        tenantId,
        selectedKey: selectedKey || null,
        selectedLabel,

        // Step3 expects this
        industries,

        // ✅ new fields (safe additive)
        suggestedKey: ensuredSuggestedKey || null,
        subIndustries,
        suggestedSubIndustryLabel: suggestedSubIndustryLabel || null,
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
    const parsed = PostSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "BAD_REQUEST", message: "Invalid request body." }, { status: 400 });
    }

    const tenantId = safeTrim(parsed.data.tenantId);
    await requireMembership(clerkUserId, tenantId);

    const industryKeyRaw = safeTrim(parsed.data.industryKey);
    const industryLabelRaw = safeTrim(parsed.data.industryLabel);

    const subIndustryKeyRaw = safeTrim(parsed.data.subIndustryKey);
    const subIndustryLabelRaw = safeTrim(parsed.data.subIndustryLabel);

    // --- Industry: create-or-select ---
    let ensuredIndustryKey = "";

    // Create-from-label path
    if (industryLabelRaw && !industryKeyRaw) {
      ensuredIndustryKey = await ensureIndustryExists(industryLabelRaw, industryLabelRaw);
    } else if (industryKeyRaw) {
      ensuredIndustryKey = await ensureIndustryExists(industryKeyRaw, industryLabelRaw || undefined);
    } else {
      return NextResponse.json(
        { ok: false, error: "INDUSTRY_REQUIRED", message: "Choose an industry." },
        { status: 400 }
      );
    }

    if (!ensuredIndustryKey) {
      return NextResponse.json(
        { ok: false, error: "BAD_REQUEST", message: "Industry is invalid." },
        { status: 400 }
      );
    }

    const savedKey = await upsertTenantIndustryKey(tenantId, ensuredIndustryKey);

    // --- Sub-industry: tenant-scoped create/select (optional) ---
    let savedSubIndustryKey = "";
    if (subIndustryLabelRaw || subIndustryKeyRaw) {
      savedSubIndustryKey = await upsertTenantSubIndustry({
        tenantId,
        label: subIndustryLabelRaw || subIndustryKeyRaw,
        key: subIndustryKeyRaw || undefined,
      });
    }

    const subIndustries = await listTenantSubIndustries(tenantId);

    return NextResponse.json(
      {
        ok: true,
        tenantId,
        selectedKey: savedKey,
        selectedSubIndustryKey: savedSubIndustryKey || null,
        subIndustries,
      },
      { status: 200 }
    );
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}