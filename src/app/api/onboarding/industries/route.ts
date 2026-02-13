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

function toBool(v: any) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v ?? "").toLowerCase().trim();
  return s === "true" || s === "t" || s === "1" || s === "yes";
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

  subIndustryKey: z.string().optional(),
  subIndustryLabel: z.string().optional(),
});

/* --------------------- db helpers --------------------- */

async function readTenantState(tenantId: string): Promise<{ savedKey: string; currentStep: number; ai: any | null }> {
  const r = await db.execute(sql`
    select
      ts.industry_key as saved_industry_key,
      o.current_step as current_step,
      o.ai_analysis as ai_analysis
    from tenants t
    left join tenant_settings ts on ts.tenant_id = t.id
    left join tenant_onboarding o on o.tenant_id = t.id
    where t.id = ${tenantId}::uuid
    limit 1
  `);

  const row = firstRow(r);
  const savedKey = normalizeKey(row?.saved_industry_key ?? "");
  const currentStep = Number(row?.current_step ?? 1) || 1;

  const ai0 = row?.ai_analysis ?? null;
  let ai: any | null = null;
  if (ai0 && typeof ai0 === "object") ai = ai0;
  if (typeof ai0 === "string") {
    try {
      ai = JSON.parse(ai0);
    } catch {
      ai = null;
    }
  }

  return { savedKey, currentStep, ai };
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

async function listDefaultSubIndustries(industryKey: string) {
  const ik = normalizeKey(industryKey);
  if (!ik) return [];

  const r = await db.execute(sql`
    select
      id::text as "id",
      industry_key::text as "industryKey",
      key::text as "key",
      label::text as "label",
      description::text as "description",
      sort_order::int as "sortOrder",
      is_active as "isActive",
      updated_at as "updatedAt"
    from industry_sub_industries
    where industry_key = ${ik}
      and is_active = true
    order by sort_order asc, label asc
    limit 500
  `);

  return rowsOf(r)
    .map((x: any) => ({
      id: String(x.id ?? ""),
      industryKey: String(x.industryKey ?? ik),
      key: String(x.key ?? ""),
      label: String(x.label ?? ""),
      description: x.description == null ? null : String(x.description),
      sortOrder: Number.isFinite(Number(x.sortOrder)) ? Number(x.sortOrder) : 0,
      updatedAt: x.updatedAt ?? null,
    }))
    .filter((x: any) => x.key && x.label);
}

async function listTenantSubIndustries(tenantId: string, industryKey: string) {
  const ik = normalizeKey(industryKey);
  if (!ik) return [];

  const r = await db.execute(sql`
    select id, key, label
    from tenant_sub_industries
    where tenant_id = ${tenantId}::uuid
      and industry_key = ${ik}
    order by label asc
  `);

  return rowsOf(r).map((x: any) => ({
    id: String(x.id),
    key: String(x.key),
    label: String(x.label),
  }));
}

/**
 * ✅ Normalize sub-industry to platform defaults first (ACTIVE ONLY)
 * - If key exists in industry_sub_industries for this industry (and is_active=true), use canonical key+label
 * - Else allow tenant override insert with normalized key and provided label
 */
async function resolveSubIndustryAgainstDefaults(args: {
  industryKey: string;
  subIndustryKey?: string;
  subIndustryLabel?: string;
}): Promise<{ key: string; label: string } | null> {
  const industryKey = normalizeKey(args.industryKey);
  if (!industryKey) return null;

  const keyGuess = normalizeKey(args.subIndustryKey || args.subIndustryLabel || "");
  const labelGuess = safeTrim(args.subIndustryLabel || "");

  if (!keyGuess) return null;

  const r = await db.execute(sql`
    select key::text as "key", label::text as "label"
    from industry_sub_industries
    where industry_key = ${industryKey}
      and key = ${keyGuess}
      and is_active = true
    limit 1
  `);

  const row = firstRow(r);
  if (row?.key) {
    const k = String(row.key);
    const lbl = safeTrim(row.label) || titleFromKey(k);
    return { key: k, label: lbl };
  }

  return { key: keyGuess, label: labelGuess || titleFromKey(keyGuess) };
}

async function upsertTenantSubIndustry(args: { tenantId: string; industryKey: string; key: string; label: string }) {
  const industryKey = normalizeKey(args.industryKey);
  const label = safeTrim(args.label);
  const key = normalizeKey(args.key);

  if (!industryKey || !label || !key) return "";

  await db.execute(sql`
    insert into tenant_sub_industries (id, tenant_id, industry_key, key, label, updated_at)
    values (gen_random_uuid(), ${args.tenantId}::uuid, ${industryKey}, ${key}, ${label}, now())
    on conflict (tenant_id, industry_key, key) do update
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

function getSuggestedIndustryKey(ai: any): string {
  if (!ai || typeof ai !== "object") return "";

  const modeAKey =
    safeTrim((ai as any)?.industryInterview?.proposedIndustry?.key) ||
    safeTrim((ai as any)?.industryInterview?.proposedIndustryKey) ||
    "";

  if (modeAKey) return normalizeKey(modeAKey);

  const direct = safeTrim((ai as any)?.suggestedIndustryKey) || safeTrim((ai as any)?.industryKey) || "";
  if (direct) return normalizeKey(direct);

  const inf = (ai as any)?.industryInference;
  if (inf && typeof inf === "object") {
    const k = safeTrim((inf as any)?.suggestedIndustryKey) || safeTrim((inf as any)?.industryKey) || "";
    if (k) return normalizeKey(k);
  }

  return "";
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

    const { savedKey, currentStep, ai } = await readTenantState(tenantId);

    // Treat tenant_settings.industry_key as "unselected" until onboarding reaches step >= 3.
    const savedIsUsable = currentStep >= 3 && Boolean(savedKey);

    const aiSuggestedKey = getSuggestedIndustryKey(ai);
    const ensuredSuggestedKey = aiSuggestedKey ? await ensureIndustryExists(aiSuggestedKey) : "";

    const industries = await listIndustries();

    const selectedKey =
      (savedIsUsable && savedKey && industries.some((x) => x.key === savedKey) ? savedKey : "") ||
      (ensuredSuggestedKey && industries.some((x) => x.key === ensuredSuggestedKey) ? ensuredSuggestedKey : "") ||
      (industries.find((x) => x.key && x.key !== "service")?.key ?? industries[0]?.key ?? "");

    const selectedLabel = selectedKey ? industries.find((x) => x.key === selectedKey)?.label ?? null : null;

    // ✅ Defaults + tenant overrides scoped to selectedKey
    const defaultSubIndustries = selectedKey ? await listDefaultSubIndustries(selectedKey) : [];
    const subIndustries = selectedKey ? await listTenantSubIndustries(tenantId, selectedKey) : [];

    const suggestedSubIndustryLabel = getSuggestedSubIndustryLabel(ai);

    return NextResponse.json(
      {
        ok: true,
        tenantId,
        industries,
        selectedKey: selectedKey || null,
        selectedLabel,
        suggestedKey: ensuredSuggestedKey || null,

        // ✅ NEW: used by Step3b quick picks
        defaultSubIndustries,

        subIndustries,
        suggestedSubIndustryLabel: suggestedSubIndustryLabel || null,

        tenantIndustryKey: savedKey || null,
        onboardingStep: currentStep,
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
    const stepFloor = subIndustryLabelRaw || subIndustryKeyRaw ? 4 : 3;
    await db.execute(sql`
      insert into tenant_onboarding (tenant_id, current_step, completed, created_at, updated_at)
      values (${tenantId}::uuid, ${stepFloor}, false, now(), now())
      on conflict (tenant_id) do update
        set current_step = greatest(tenant_onboarding.current_step, ${stepFloor}),
            updated_at = now()
    `);

    // --- Sub-industry: optional (✅ normalized) ---
    let savedSubIndustryKey = "";
    if (subIndustryLabelRaw || subIndustryKeyRaw) {
      const resolved = await resolveSubIndustryAgainstDefaults({
        industryKey: savedKey,
        subIndustryKey: subIndustryKeyRaw || undefined,
        subIndustryLabel: subIndustryLabelRaw || undefined,
      });

      if (resolved) {
        savedSubIndustryKey = await upsertTenantSubIndustry({
          tenantId,
          industryKey: savedKey,
          key: resolved.key,
          label: resolved.label,
        });
      }
    }

    const subIndustries = await listTenantSubIndustries(tenantId, savedKey);

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