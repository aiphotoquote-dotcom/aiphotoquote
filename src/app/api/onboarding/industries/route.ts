// src/app/api/onboarding/industries/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* --------------------- utils --------------------- */

type Mode = "new" | "update" | "existing";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function firstRow(r: any): any | null {
  if (!r) return null;
  if (Array.isArray(r)) return r[0] ?? null;
  if (Array.isArray((r as any).rows)) return (r as any).rows[0] ?? null;
  // drizzle RowList sometimes is array-like
  if (typeof r === "object" && r !== null && (r as any)[0]) return (r as any)[0] ?? null;
  return null;
}

function rowsOf(r: any): any[] {
  if (!r) return [];
  if (Array.isArray(r)) return r;
  if (Array.isArray((r as any).rows)) return (r as any).rows;
  // drizzle RowList sometimes is array-like
  if (typeof r === "object" && r !== null && typeof (r as any).length === "number") {
    try {
      return Array.from(r as any);
    } catch {
      return [];
    }
  }
  return [];
}

function titleFromKey(key: string) {
  // marine_repair -> Marine Repair
  const s = safeTrim(key).replace(/[-_]+/g, " ").trim();
  if (!s) return "Service";
  return s
    .split(" ")
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(" ");
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

function dbErrMessage(e: any) {
  // Drizzle/postgres errors usually carry message + code + detail
  const msg = String(e?.message ?? "").trim();
  const code = String(e?.code ?? "").trim();
  const detail = String(e?.detail ?? "").trim();
  const hint = String(e?.hint ?? "").trim();

  const parts = [
    msg || "Database error",
    code ? `code=${code}` : "",
    detail ? `detail=${detail}` : "",
    hint ? `hint=${hint}` : "",
  ].filter(Boolean);

  return parts.join(" | ");
}

/* --------------------- schema --------------------- */

const GetSchema = z.object({
  tenantId: z.string().min(1),
});

const PostSchema = z.object({
  tenantId: z.string().min(1),
  // caller either selects an existing key OR creates a new label
  industryKey: z.string().optional(),
  industryLabel: z.string().optional(),
});

/* --------------------- core ops --------------------- */

async function readSuggestedKeyFromAiAnalysis(tenantId: string): Promise<string> {
  const r = await db.execute(sql`
    select ai_analysis
    from tenant_onboarding
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);
  const row = firstRow(r);
  const ai = row?.ai_analysis ?? null;
  const suggested = safeTrim(ai?.suggestedIndustryKey ?? "");
  return suggested;
}

async function ensureIndustryExistsByKey(key: string): Promise<void> {
  const k = safeTrim(key);
  if (!k) return;

  const label = titleFromKey(k);

  // IMPORTANT:
  // We explicitly set id = gen_random_uuid() to avoid depending on DB defaults.
  // This makes the insert succeed even if industries.id has no DEFAULT.
  await db.execute(sql`
    insert into industries (id, key, label, description)
    values (gen_random_uuid(), ${k}, ${label}, null)
    on conflict (key) do nothing
  `);
}

async function listIndustries(): Promise<
  { id: string; key: string; label: string; description: string | null; source: "platform" | "tenant" }[]
> {
  const r = await db.execute(sql`
    select id, key, label, description
    from industries
    order by label asc
  `);

  const rows = rowsOf(r);
  return rows.map((x: any) => ({
    id: String(x.id),
    key: String(x.key),
    label: String(x.label),
    description: x.description == null ? null : String(x.description),
    source: "platform" as const,
  }));
}

async function readSelectedIndustryKey(tenantId: string): Promise<string | null> {
  const r = await db.execute(sql`
    select industry_key
    from tenant_settings
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);
  const row = firstRow(r);
  const k = safeTrim(row?.industry_key ?? "");
  return k || null;
}

async function saveSelectedIndustryKey(tenantId: string, key: string): Promise<void> {
  const k = safeTrim(key);
  if (!k) return;

  await db.execute(sql`
    insert into tenant_settings (tenant_id, industry_key, updated_at)
    values (${tenantId}::uuid, ${k}, now())
    on conflict (tenant_id) do update
    set industry_key = excluded.industry_key,
        updated_at = now()
  `);

  // advance onboarding step
  await db.execute(sql`
    update tenant_onboarding
    set current_step = greatest(current_step, 4),
        updated_at = now()
    where tenant_id = ${tenantId}::uuid
  `);
}

/* --------------------- handlers --------------------- */

export async function GET(req: Request) {
  try {
    const { clerkUserId } = await requireAuthed();

    const u = new URL(req.url);
    const parsed = GetSchema.safeParse({ tenantId: u.searchParams.get("tenantId") });
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "TENANT_ID_REQUIRED", message: "tenantId is required." }, { status: 400 });
    }

    const tenantId = safeTrim(parsed.data.tenantId);
    await requireMembership(clerkUserId, tenantId);

    // 1) read AI suggestion and attempt auto-create (safe even if it already exists)
    const suggested = await readSuggestedKeyFromAiAnalysis(tenantId);
    if (suggested) {
      try {
        await ensureIndustryExistsByKey(suggested);
      } catch (e: any) {
        return NextResponse.json(
          {
            ok: false,
            error: "DB_INDUSTRY_AUTO_CREATE_FAILED",
            message: dbErrMessage(e),
          },
          { status: 500 }
        );
      }
    }

    // 2) list industries
    let industries: any[] = [];
    try {
      industries = await listIndustries();
    } catch (e: any) {
      return NextResponse.json(
        {
          ok: false,
          error: "DB_INDUSTRY_LIST_FAILED",
          message: dbErrMessage(e),
        },
        { status: 500 }
      );
    }

    const selectedKey = await readSelectedIndustryKey(tenantId);

    return NextResponse.json(
      {
        ok: true,
        tenantId,
        selectedKey,
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
    const parsed = PostSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "BAD_REQUEST", message: "Invalid request body." }, { status: 400 });
    }

    const tenantId = safeTrim(parsed.data.tenantId);
    await requireMembership(clerkUserId, tenantId);

    const industryKey = safeTrim(parsed.data.industryKey);
    const industryLabel = safeTrim(parsed.data.industryLabel);

    // Create-new mode: label provided
    if (industryLabel) {
      // convert label to a stable key: "Marine Repair" -> "marine_repair"
      const key = industryLabel
        .toLowerCase()
        .replace(/&/g, "and")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 48) || "service";

      try {
        await db.execute(sql`
          insert into industries (id, key, label, description)
          values (gen_random_uuid(), ${key}, ${industryLabel}, null)
          on conflict (key) do update
          set label = excluded.label
        `);
      } catch (e: any) {
        return NextResponse.json(
          { ok: false, error: "DB_INDUSTRY_CREATE_FAILED", message: dbErrMessage(e) },
          { status: 500 }
        );
      }

      await saveSelectedIndustryKey(tenantId, key);

      return NextResponse.json({ ok: true, tenantId, selectedKey: key }, { status: 200 });
    }

    // Select-existing mode
    if (!industryKey) {
      return NextResponse.json({ ok: false, error: "INDUSTRY_REQUIRED", message: "industryKey or industryLabel is required." }, { status: 400 });
    }

    // ensure exists (safe), then save to tenant_settings
    try {
      await ensureIndustryExistsByKey(industryKey);
    } catch (e: any) {
      return NextResponse.json(
        { ok: false, error: "DB_INDUSTRY_ENSURE_FAILED", message: dbErrMessage(e) },
        { status: 500 }
      );
    }

    await saveSelectedIndustryKey(tenantId, industryKey);

    return NextResponse.json({ ok: true, tenantId, selectedKey: industryKey }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}