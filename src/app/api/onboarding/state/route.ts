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

function firstRow(r: any): any | null {
  if (!r) return null;
  if (Array.isArray(r)) return r[0] ?? null;
  if (Array.isArray(r.rows)) return r.rows[0] ?? null;
  return null;
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

/**
 * Ensure membership for explicit edit tenant.
 */
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

/**
 * Ensure app_users row exists (portable identity).
 * IMPORTANT: uses ON CONFLICT (auth_provider, auth_subject) because your DB has a UNIQUE INDEX.
 */
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

export async function GET(req: Request) {
  try {
    const { mode, tenantId: rawTenantId } = getQuery(req);
    const { clerkUserId } = await requireAuthed();

    // ✅ default is NEW tenant (even if the user already has tenants)
    if (mode === "new") {
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
        },
        { status: 200 }
      );
    }

    // update/existing requires explicit tenantId
    const tenantId = safeTrim(rawTenantId);
    if (!tenantId) {
      return NextResponse.json(
        { ok: false, error: "TENANT_ID_REQUIRED", message: "tenantId is required for mode=update/existing" },
        { status: 400 }
      );
    }

    await requireMembership(clerkUserId, tenantId);

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

    return NextResponse.json(
      {
        ok: true,
        isAuthenticated: true,
        tenantId,
        tenantName: row?.tenant_name ?? null,
        currentStep: row?.current_step ?? 1,
        completed: row?.completed ?? false,
        website: row?.website ?? null,
        aiAnalysis: row?.ai_analysis ?? null,
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

    // If client omitted owner fields (signed-in path), derive from Clerk
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

    // ✅ mode=update/existing: must target an existing tenant and user must be a member
    if (mode === "update" || mode === "existing") {
      const t = safeTrim(body?.tenantId) || safeTrim(queryTenantId);
      if (!t) {
        return NextResponse.json({ ok: false, error: "TENANT_ID_REQUIRED" }, { status: 400 });
      }
      await requireMembership(clerkUserId, t);
      tenantId = t;
    }

    // ✅ mode=new: ALWAYS create a new tenant (do NOT "pick first tenant")
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
      // update identity for an existing tenant
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

    // Persist website + advance to step 2
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