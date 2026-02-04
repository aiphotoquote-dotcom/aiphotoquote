import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";

import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
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

/**
 * Ensure we have an app_users row for this Clerk user.
 * IMPORTANT: use ON CONFLICT (auth_provider, auth_subject) because your DB has a UNIQUE INDEX,
 * not a named UNIQUE CONSTRAINT.
 */
async function ensureAppUser(): Promise<{ appUserId: string; clerkUserId: string }> {
  const a = await auth();
  const clerkUserId = a?.userId ?? null;
  if (!clerkUserId) throw new Error("UNAUTHENTICATED");

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

  return { appUserId, clerkUserId };
}

/**
 * Returns the "first" tenant for this user (legacy/default behavior).
 */
async function findFirstTenantForClerkUser(clerkUserId: string): Promise<string | null> {
  const r = await db.execute(sql`
    select tenant_id
    from tenant_members
    where clerk_user_id = ${clerkUserId}
    order by created_at asc
    limit 1
  `);

  const row = firstRow(r);
  return row?.tenant_id ? String(row.tenant_id) : null;
}

/**
 * Ensure the user is a member of tenantId (authorization gate for edit flows).
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
 * Resolve tenant context:
 * - If URL has ?tenantId=<uuid> => treat as edit flow (must be a member)
 * - Else: default to the first tenant (legacy behavior)
 */
function getTenantIdFromRequest(req: Request): string {
  try {
    const u = new URL(req.url);
    return safeTrim(u.searchParams.get("tenantId"));
  } catch {
    return "";
  }
}

export async function GET(req: Request) {
  try {
    const { clerkUserId } = await ensureAppUser();

    const explicitTenantId = getTenantIdFromRequest(req);
    let tenantId = explicitTenantId || (await findFirstTenantForClerkUser(clerkUserId));

    // If caller explicitly asked for a tenant, enforce membership
    if (explicitTenantId) {
      await requireMembership(clerkUserId, explicitTenantId);
    }

    if (!tenantId) {
      return NextResponse.json(
        {
          ok: true,
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
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    if (Number(body?.step) !== 1) {
      return NextResponse.json({ ok: false, error: "UNSUPPORTED_STEP" }, { status: 400 });
    }

    const businessName = safeTrim(body?.businessName);
    const website = safeTrim(body?.website);

    // Optional controls to support the 3 entry points:
    // - tenantId: edit a specific tenant
    // - createNewTenant: force creating a new tenant even if user already has one
    const requestedTenantId = safeTrim(body?.tenantId);
    const createNewTenant = Boolean(body?.createNewTenant);

    if (businessName.length < 2) {
      return NextResponse.json({ ok: false, error: "BUSINESS_NAME_REQUIRED" }, { status: 400 });
    }

    const { appUserId, clerkUserId } = await ensureAppUser();

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

    // 1) Explicit edit flow
    if (requestedTenantId) {
      await requireMembership(clerkUserId, requestedTenantId);
      tenantId = requestedTenantId;
    }

    // 2) Existing user / new tenant (force create)
    if (!tenantId && createNewTenant) {
      tenantId = null; // explicit
    }

    // 3) Default legacy behavior: use first tenant if it exists
    if (!tenantId && !createNewTenant) {
      tenantId = await findFirstTenantForClerkUser(clerkUserId);
    }

    // If no tenant context, create a new tenant
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
      // Update existing tenant identity
      await db.execute(sql`
        update tenants
        set name = ${businessName}
        where id = ${tenantId}::uuid
      `);

      await db.execute(sql`
        update tenant_settings
        set business_name = ${businessName}, updated_at = now()
        where tenant_id = ${tenantId}::uuid
      `);
    }

    // ✅ Persist website to tenant_onboarding so analyze-website can read it
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
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}