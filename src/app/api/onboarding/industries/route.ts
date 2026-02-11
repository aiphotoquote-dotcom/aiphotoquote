// src/app/api/onboarding/industries/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* --------------------- utils --------------------- */

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function normalizeKey(raw: string) {
  const s = safeTrim(raw).toLowerCase();
  if (!s) return "";
  return s
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
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

function firstRow(r: any): any | null {
  if (!r) return null;
  if (Array.isArray(r)) return r[0] ?? null;
  if (Array.isArray((r as any)?.rows)) return (r as any).rows[0] ?? null;
  if (typeof r === "object" && r !== null && 0 in r) return (r as any)[0] ?? null;
  return null;
}

function rowsOf(r: any): any[] {
  if (!r) return [];
  if (Array.isArray(r)) return r;
  if (Array.isArray((r as any)?.rows)) return (r as any).rows;
  if (typeof r === "object" && r !== null && "length" in r) return Array.from(r as any);
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

/* --------------------- schema --------------------- */

const GetSchema = z.object({
  tenantId: z.string().min(1),
});

// IMPORTANT: accept both legacy + current field names
const PostSchema = z.object({
  tenantId: z.string().min(1),

  industryKey: z.string().optional(),
  industryLabel: z.string().optional(),

  // Current UI might send either:
  // - subIndustryLabel (wizard)
  // - subIndustryKey/subIndustryLabel (future)
  subIndustryKey: z.string().optional(),
  subIndustryLabel: z.string().optional(),
});

/* --------------------- db helpers --------------------- */

async function readTenantIndustryKey(tenantId: string): Promise<string> {
  const r = await db.execute(sql`
    select industry_key
    from tenant_settings
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);
  const row = firstRow(r);
  return normalizeKey(row?.industry_key ?? "");
}

async function readAiAnalysis(tenantId: string): Promise<any | null> {
  const r = await db.execute(sql`
    select ai_analysis
    from tenant_onboarding
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);
  const row = firstRow(r);
  return row?.ai_analysis ?? null;
}

async function ensureIndustryExists(industryKeyOrLabelRaw: string, explicitLabel?: string) {
  const key = normalizeKey(industryKeyOrLabelRaw);
  if (!key) return "";

  const label = safeTrim(explicitLabel) || titleFromKey(key);

  await db.execute(sql`
    insert into industries (id, key, label, description)
    values (gen_random_uuid(), ${key}, ${label}, null)
    on conflict (key) do update
      set label = excluded.label
  `);

  return key;
}

async function listIndustries() {
  const r = await db.execute(sql`
    select id, key, label, description
    from industries
    order by label asc
  `);

  return rowsOf(r).map((x: any) => ({
    id: String(x.id),
    key: String(x.key),
    label: String(x.label),
    description: x.description == null ? null : String(x.description),
    source: "platform" as const,
  }));
}

async function upsertTenantIndustryKey(tenantId: string, industryKeyRaw: string) {
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

async function listTenantSubIndustries(tenantId: string) {
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

async function upsertTenantSubIndustry(args: { tenantId: string; label: string; key?: string }) {
  const label = safeTrim(args.label);
  const key = normalizeKey(args.key || label);
  if (!label || !key) return "";

  await db.execute(sql`
    insert into tenant_sub_industries (id, tenant_id, key, label, updated_at)
    values (gen_random_uuid(), ${args.tenantId}::uuid, ${key}, ${label}, now())
    on conflict (tenant_id, key) do update
      set label = excluded.label,
          updated_at = now()
  `);

  return key;
}

function getSuggestedSubIndustryLabel(ai: any): string {
  if (!ai || typeof ai !== "object") return "";
  return (
    safeTrim((ai as any).suggestedSubIndustryLabel) ||
    safeTrim((ai as any).subIndustryLabel) ||
    safeTrim((ai as any).subIndustryGuess) ||
    safeTrim((ai as any)?.industryInference?.suggestedSubIndustryLabel) ||
    safeTrim((ai as any)?.industryInference?.subIndustryLabel) ||
    safeTrim((ai as any)?.industryInference?.subIndustryGuess) ||
    ""
  );
}

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

    const savedKey = await readTenantIndustryKey(tenantId);

    const ai = await readAiAnalysis(tenantId);
    const aiSuggestedKey = normalizeKey(ai?.suggestedIndustryKey ?? "");

    // Ensure suggested exists (so it can appear in dropdown), but do not auto-select/persist here.
    const ensuredSuggestedKey = aiSuggestedKey ? await ensureIndustryExists(aiSuggestedKey) : "";

    const industries = await listIndustries();

    const selectedKey =
      (savedKey && industries.some((x) => x.key === savedKey) ? savedKey : "") ||
      (ensuredSuggestedKey && industries.some((x) => x.key === ensuredSuggestedKey) ? ensuredSuggestedKey : "") ||
      (industries.find((x) => x.key && x.key !== "service")?.key ?? industries[0]?.key ?? "");

    const selectedLabel = selectedKey ? industries.find((x) => x.key === selectedKey)?.label ?? null : null;

    const subIndustries = await listTenantSubIndustries(tenantId);
    const suggestedSubIndustryLabel = getSuggestedSubIndustryLabel(ai);

    return NextResponse.json(
      {
        ok: true,
        tenantId,
        industries,
        selectedKey: selectedKey || null,
        selectedLabel,
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

    // Accept wizard field name: subIndustryLabel (optional)
    const subIndustryLabelRaw = safeTrim(parsed.data.subIndustryLabel);
    const subIndustryKeyRaw = safeTrim(parsed.data.subIndustryKey);

    // --- Industry: required ---
    let ensuredIndustryKey = "";
    if (industryLabelRaw && !industryKeyRaw) {
      ensuredIndustryKey = await ensureIndustryExists(industryLabelRaw, industryLabelRaw);
    } else if (industryKeyRaw) {
      ensuredIndustryKey = await ensureIndustryExists(industryKeyRaw, industryLabelRaw || undefined);
    } else {
      return NextResponse.json({ ok: false, error: "INDUSTRY_REQUIRED", message: "Choose an industry." }, { status: 400 });
    }

    if (!ensuredIndustryKey) {
      return NextResponse.json({ ok: false, error: "BAD_REQUEST", message: "Industry is invalid." }, { status: 400 });
    }

    const savedKey = await upsertTenantIndustryKey(tenantId, ensuredIndustryKey);

    // Move onboarding forward so refresh() doesn't drag the UI back.
    // - Industry chosen => step >= 3
    // - Sub-industry chosen => step >= 4
    const stepFloor = subIndustryLabelRaw || subIndustryKeyRaw ? 4 : 3;
    await db.execute(sql`
      insert into tenant_onboarding (tenant_id, current_step, completed, created_at, updated_at)
      values (${tenantId}::uuid, ${stepFloor}, false, now(), now())
      on conflict (tenant_id) do update
        set current_step = greatest(tenant_onboarding.current_step, ${stepFloor}),
            updated_at = now()
    `);

    // --- Sub-industry: optional ---
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