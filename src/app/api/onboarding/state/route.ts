// src/app/api/onboarding/state/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";

import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Mode = "new" | "update" | "existing";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function safeMode(v: unknown): Mode {
  const s = safeTrim(v).toLowerCase();
  if (s === "update") return "update";
  if (s === "existing") return "existing";
  return "new";
}

// Drizzle RowList can be array-like; avoid `.rows`
function firstRow(r: any): any | null {
  try {
    if (!r) return null;
    if (Array.isArray(r)) return r[0] ?? null;
    if (typeof r === "object" && r !== null && 0 in r) return (r as any)[0] ?? null;
    return null;
  } catch {
    return null;
  }
}

function slugify(name: string) {
  const base = safeTrim(name)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return base || `tenant-${Math.random().toString(16).slice(2, 8)}`;
}

function getQuery(req: Request) {
  try {
    const u = new URL(req.url);
    const mode = safeMode(u.searchParams.get("mode"));
    const tenantId = safeTrim(u.searchParams.get("tenantId"));
    return { mode, tenantId };
  } catch {
    return { mode: "new" as Mode, tenantId: "" };
  }
}

async function requireAuthed(): Promise<{ clerkUserId: string }> {
  const a = await auth();
  const clerkUserId = a?.userId ?? null;
  if (!clerkUserId) throw new Error("UNAUTHENTICATED");
  return { clerkUserId };
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

async function ensureAppUser(clerkUserId: string): Promise<{ appUserId: string }> {
  const u = await currentUser();
  const email = u?.emailAddresses?.[0]?.emailAddress ?? null;
  const name = u?.fullName ?? u?.firstName ?? null;

  const r = await db.execute(sql`
    insert into app_users (id, auth_provider, auth_subject, email, name, created_at, updated_at)
    values (gen_random_uuid(), 'clerk', ${clerkUserId}, ${email}, ${name}, now(), now())
    on conflict (auth_provider, auth_subject) do update
    set email = coalesce(excluded.email, app_users.email),
        name = coalesce(excluded.name, app_users.name),
        updated_at = now()
    returning id
  `);

  const row = firstRow(r);
  const appUserId = row?.id ? String(row.id) : null;
  if (!appUserId) throw new Error("FAILED_TO_UPSERT_APP_USER");
  return { appUserId };
}

/* --------------------- AI meta derivation --------------------- */

function getConfidence(ai: any): number {
  const n = Number(ai?.confidenceScore ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function getNeedsConfirmation(ai: any): boolean {
  const v = ai?.needsConfirmation;
  if (typeof v === "boolean") return v;
  return getConfidence(ai) < 0.8;
}

function getLastCorrectionFallback(ai: any): any | null {
  const hist = Array.isArray(ai?.confirmationHistory) ? ai.confirmationHistory : [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const h = hist[i];
    if (h && h.answer === "no") return h;
  }
  return null;
}

function deriveAiMeta(aiAnalysis: any | null) {
  const target = 0.8;

  if (!aiAnalysis) {
    return {
      aiAnalysisStatus: "idle",
      aiAnalysisRound: 0,
      aiAnalysisLastAction: "",
      aiAnalysisError: null as string | null,
      aiAnalysisConfidenceTarget: target,
      aiAnalysisUserCorrection: null as any | null,
    };
  }

  const meta = aiAnalysis?.meta && typeof aiAnalysis.meta === "object" ? aiAnalysis.meta : {};

  // ✅ Prefer meta.* from our new analyze/confirm handlers
  const metaStatus = String(meta?.status ?? "").trim().toLowerCase(); // running | complete | error
  const status =
    metaStatus === "running" || metaStatus === "complete" || metaStatus === "error"
      ? metaStatus
      : "complete";

  const roundRaw = Number(meta?.round ?? NaN);
  const round =
    Number.isFinite(roundRaw) && roundRaw > 0
      ? roundRaw
      : (() => {
          const hist = Array.isArray(aiAnalysis?.confirmationHistory) ? aiAnalysis.confirmationHistory : [];
          return Math.max(1, hist.length ? hist.length : 1);
        })();

  const lastAction = String(meta?.lastAction ?? "").trim();
  const error = String(meta?.error ?? "").trim();

  // keep backwards compat for "needsConfirmation"
  const conf = getConfidence(aiAnalysis);
  const needs = getNeedsConfirmation(aiAnalysis);

  const userCorrection = meta?.userCorrection ?? getLastCorrectionFallback(aiAnalysis);

  // If meta doesn't have lastAction, derive something sane
  const derivedLastAction =
    lastAction ||
    (status === "running"
      ? "Analyzing website…"
      : status === "error"
      ? "AI analysis failed."
      : needs
      ? "Waiting for your confirmation/correction."
      : "AI analysis complete.");

  return {
    aiAnalysisStatus: status,
    aiAnalysisRound: round,
    aiAnalysisLastAction: derivedLastAction,
    aiAnalysisError: error || (status === "error" ? "Unknown error" : null),
    aiAnalysisConfidenceTarget: target,
    aiAnalysisUserCorrection: userCorrection ?? null,
  };
}

/* --------------------- db read --------------------- */

async function readTenantOnboarding(tenantId: string) {
  const r = await db.execute(sql`
    select
      t.name as tenant_name,
      o.current_step,
      o.completed,
      o.website,
      o.ai_analysis
    from tenants t
    left join tenant_onboarding o on o.tenant_id = t.id
    where t.id = ${tenantId}::uuid
    limit 1
  `);

  const row = firstRow(r);

  const aiAnalysis = row?.ai_analysis ?? null;
  const derived = deriveAiMeta(aiAnalysis);

  return {
    tenantName: row?.tenant_name ?? null,
    currentStep: row?.current_step ?? 1,
    completed: row?.completed ?? false,
    website: row?.website ?? null,
    aiAnalysis: aiAnalysis ?? null,
    ...derived,
  };
}

/* --------------------- handlers --------------------- */

export async function GET(req: Request) {
  try {
    const { mode, tenantId } = getQuery(req);
    const { clerkUserId } = await requireAuthed();

    // ✅ mode=new with NO tenantId -> start fresh onboarding session
    if (mode === "new" && !tenantId) {
      return NextResponse.json(
        {
          ok: true,
          isAuthenticated: true,
          tenantId: null,
          tenantName: null,
          currentStep: 1,
          completed: false,
          website: null,
          aiAnalysis: null,
          aiAnalysisStatus: "idle",
          aiAnalysisRound: 0,
          aiAnalysisLastAction: "",
          aiAnalysisError: null,
          aiAnalysisConfidenceTarget: 0.8,
          aiAnalysisUserCorrection: null,
        },
        { status: 200 }
      );
    }

    if (!tenantId) {
      return NextResponse.json(
        { ok: false, error: "TENANT_ID_REQUIRED", message: "tenantId is required for this request." },
        { status: 400 }
      );
    }

    await requireMembership(clerkUserId, tenantId);
    const data = await readTenantOnboarding(tenantId);

    return NextResponse.json(
      {
        ok: true,
        isAuthenticated: true,
        tenantId,
        ...data,
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
    const { mode, tenantId: queryTenantId } = getQuery(req);
    const { clerkUserId } = await requireAuthed();

    const body = await req.json().catch(() => null);
    if (Number(body?.step) !== 1) {
      return NextResponse.json({ ok: false, error: "UNSUPPORTED_STEP" }, { status: 400 });
    }

    const businessName = safeTrim(body?.businessName);
    const website = safeTrim(body?.website);

    if (businessName.length < 2) {
      return NextResponse.json({ ok: false, error: "BUSINESS_NAME_REQUIRED" }, { status: 400 });
    }

    const { appUserId } = await ensureAppUser(clerkUserId);

    // derive owner fields if omitted
    let ownerName = safeTrim(body?.ownerName);
    let ownerEmail = safeTrim(body?.ownerEmail);

    if (!ownerName || !ownerEmail) {
      const u = await currentUser();
      ownerEmail = ownerEmail || (u?.emailAddresses?.[0]?.emailAddress ?? "");
      ownerName = ownerName || (u?.fullName ?? u?.firstName ?? "");
      ownerName = safeTrim(ownerName);
      ownerEmail = safeTrim(ownerEmail);
    }

    if (ownerName.length < 2) {
      return NextResponse.json({ ok: false, error: "OWNER_NAME_REQUIRED" }, { status: 400 });
    }
    if (!ownerEmail.includes("@")) {
      return NextResponse.json({ ok: false, error: "OWNER_EMAIL_REQUIRED" }, { status: 400 });
    }

    let tenantId: string | null = null;

    // update/existing targets a specific tenant
    if (mode === "update" || mode === "existing") {
      const t = safeTrim(body?.tenantId) || safeTrim(queryTenantId);
      if (!t) return NextResponse.json({ ok: false, error: "TENANT_ID_REQUIRED" }, { status: 400 });
      await requireMembership(clerkUserId, t);
      tenantId = t;
    }

    // mode=new always creates a new tenant
    if (!tenantId) {
      const baseSlug = slugify(businessName);
      const slug = `${baseSlug}-${Math.random().toString(16).slice(2, 6)}`;

      const tIns = await db.execute(sql`
        insert into tenants (id, name, slug, owner_user_id, owner_clerk_user_id, created_at)
        values (gen_random_uuid(), ${businessName}, ${slug}, ${appUserId}::uuid, ${clerkUserId}, now())
        returning id
      `);

      const trow = firstRow(tIns);
      if (!trow?.id) throw new Error("FAILED_TO_CREATE_TENANT");
      tenantId = String(trow.id);

      await db.execute(sql`
        insert into tenant_members (tenant_id, clerk_user_id, role, status, created_at, updated_at)
        values (${tenantId}::uuid, ${clerkUserId}, 'owner', 'active', now(), now())
        on conflict do nothing
      `);

      await db.execute(sql`
        insert into tenant_settings (tenant_id, industry_key, business_name, updated_at)
        values (${tenantId}::uuid, 'service', ${businessName}, now())
        on conflict (tenant_id) do update
        set business_name = excluded.business_name,
            updated_at = now()
      `);
    } else {
      await db.execute(sql`
        update tenants
        set name = ${businessName}
        where id = ${tenantId}::uuid
      `);

      await db.execute(sql`
        insert into tenant_settings (tenant_id, business_name, updated_at)
        values (${tenantId}::uuid, ${businessName}, now())
        on conflict (tenant_id) do update
        set business_name = excluded.business_name,
            updated_at = now()
      `);
    }

    await db.execute(sql`
      insert into tenant_onboarding (tenant_id, website, current_step, completed, created_at, updated_at)
      values (${tenantId}::uuid, ${website || null}, 2, false, now(), now())
      on conflict (tenant_id) do update
      set website = excluded.website,
          current_step = greatest(tenant_onboarding.current_step, 2),
          updated_at = now()
    `);

    return NextResponse.json({ ok: true, tenantId }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}