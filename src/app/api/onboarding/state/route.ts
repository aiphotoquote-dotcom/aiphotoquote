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
 * Robust upsert that does NOT depend on a specific constraint name.
 * Works as long as a unique index/constraint exists on (auth_provider, auth_subject).
 */
async function ensureAppUser(): Promise<{ appUserId: string; clerkUserId: string }> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHENTICATED");

  const u = await currentUser();
  const email = u?.emailAddresses?.[0]?.emailAddress ?? null;
  const name = u?.fullName ?? u?.firstName ?? null;

  const r = await db.execute(sql`
    insert into app_users (id, auth_provider, auth_subject, email, name, created_at, updated_at)
    values (gen_random_uuid(), 'clerk', ${userId}, ${email}, ${name}, now(), now())
    on conflict (auth_provider, auth_subject)
    do update set
      email = coalesce(excluded.email, app_users.email),
      name = coalesce(excluded.name, app_users.name),
      updated_at = now()
    returning id
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  if (!row?.id) throw new Error("FAILED_TO_UPSERT_APP_USER");

  return { appUserId: String(row.id), clerkUserId: userId };
}

/**
 * Find an onboarding tenant for this Clerk user.
 * Primary path uses tenants.owner_clerk_user_id (back-compat and typically present in prod).
 * Fallback tries tenant_members/app_users linkage (best effort).
 */
async function findTenantForClerkUser(clerkUserId: string, appUserId: string): Promise<string | null> {
  // 1) Primary: back-compat owner pointer
  try {
    const r1 = await db.execute(sql`
      select id
      from tenants
      where owner_clerk_user_id = ${clerkUserId}
      limit 1
    `);
    const row1: any = (r1 as any)?.rows?.[0] ?? (Array.isArray(r1) ? (r1 as any)[0] : null);
    if (row1?.id) return String(row1.id);
  } catch {
    // ignore
  }

  // 2) Secondary: portable owner pointer (newer schema)
  try {
    const r2 = await db.execute(sql`
      select id
      from tenants
      where owner_user_id::text = ${appUserId}::text
      limit 1
    `);
    const row2: any = (r2 as any)?.rows?.[0] ?? (Array.isArray(r2) ? (r2 as any)[0] : null);
    if (row2?.id) return String(row2.id);
  } catch {
    // ignore
  }

  // 3) Fallback: tenant_members (only if schema supports it in prod)
  try {
    const r3 = await db.execute(sql`
      select tm.tenant_id
      from tenant_members tm
      where tm.user_id::text = ${appUserId}::text
      limit 1
    `);
    const row3: any = (r3 as any)?.rows?.[0] ?? (Array.isArray(r3) ? (r3 as any)[0] : null);
    if (row3?.tenant_id) return String(row3.tenant_id);
  } catch {
    // ignore — prod may not have user_id, which is exactly what we’re protecting against
  }

  return null;
}

export async function GET() {
  try {
    const { appUserId, clerkUserId } = await ensureAppUser();
    const tenantId = await findTenantForClerkUser(clerkUserId, appUserId);

    if (!tenantId) {
      return NextResponse.json(
        { ok: true, tenantId: null, tenantName: null, currentStep: 1, completed: false, website: null, aiAnalysis: null },
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

    const row: any = (r as any)?.rows?.[0] ?? null;

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
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
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
const ownerName = safeTrim(body?.ownerName);
const ownerEmail = safeTrim(body?.ownerEmail);
const website = safeTrim(body?.website);

if (businessName.length < 2) {
  return NextResponse.json({ ok: false, error: "BUSINESS_NAME_REQUIRED" }, { status: 400 });
}

// Determine if this is an existing app user
const appUserId = await ensureAppUser();
let tenantId = await findTenantForUser(appUserId);

// ONLY require owner fields if this is a brand-new user with no tenant context
const isFirstTimeUser = !tenantId;

if (isFirstTimeUser) {
  if (ownerName.length < 2) {
    return NextResponse.json({ ok: false, error: "OWNER_NAME_REQUIRED" }, { status: 400 });
  }
  if (!ownerEmail.includes("@")) {
    return NextResponse.json({ ok: false, error: "OWNER_EMAIL_REQUIRED" }, { status: 400 });
  }
}

    const { appUserId, clerkUserId } = await ensureAppUser();
    let tenantId = await findTenantForClerkUser(clerkUserId, appUserId);

    // Create tenant if first time
    if (!tenantId) {
      const baseSlug = slugify(businessName);
      const slug = `${baseSlug}-${Math.random().toString(16).slice(2, 6)}`;

      const tIns = await db.execute(sql`
        insert into tenants (id, name, slug, owner_user_id, owner_clerk_user_id, created_at)
        values (gen_random_uuid(), ${businessName}, ${slug}, ${appUserId}::uuid, ${clerkUserId}, now())
        returning id
      `);

      const trow: any = (tIns as any)?.rows?.[0] ?? null;
      if (!trow?.id) throw new Error("FAILED_TO_CREATE_TENANT");
      tenantId = String(trow.id);

      // best-effort membership insert (ignore if schema differs)
      try {
        await db.execute(sql`
          insert into tenant_members (id, tenant_id, user_id, role, created_at)
          values (gen_random_uuid(), ${tenantId}::uuid, ${appUserId}::uuid, 'owner', now())
          on conflict do nothing
        `);
      } catch {
        // ignore
      }

      // seed minimal settings (industryKey required)
      await db.execute(sql`
        insert into tenant_settings (tenant_id, industry_key, business_name, updated_at)
        values (${tenantId}::uuid, 'service', ${businessName}, now())
        on conflict (tenant_id) do update
        set business_name = excluded.business_name,
            updated_at = now()
      `);
    } else {
      // keep tenant name aligned
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

    // upsert onboarding state
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
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}