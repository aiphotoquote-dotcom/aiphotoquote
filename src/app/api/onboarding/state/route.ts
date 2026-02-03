// src/app/api/onboarding/state/route.ts

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
 * Ensure we have an app_users row for this Clerk user.
 * Returns both portable appUserId + clerkUserId.
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
    on conflict on constraint app_users_provider_subject_uq do update
    set email = coalesce(excluded.email, app_users.email),
        name = coalesce(excluded.name, app_users.name),
        updated_at = now()
    returning id
  `);

  const row: any = (r as any)?.rows?.[0] ?? null;
  const appUserId = row?.id ? String(row.id) : null;
  if (!appUserId) throw new Error("FAILED_TO_UPSERT_APP_USER");

  return { appUserId, clerkUserId };
}

/**
 * Your prod DB tenant_members uses clerk_user_id (NOT user_id).
 */
async function findTenantForClerkUser(clerkUserId: string): Promise<string | null> {
  const r = await db.execute(sql`
    select tenant_id
    from tenant_members
    where clerk_user_id = ${clerkUserId}
    order by created_at asc
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? null;
  return row?.tenant_id ? String(row.tenant_id) : null;
}

export async function GET() {
  try {
    const { appUserId, clerkUserId } = await ensureAppUser();
    const tenantId = await findTenantForClerkUser(clerkUserId);

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
    const website = safeTrim(body?.website);

    if (businessName.length < 2) {
      return NextResponse.json({ ok: false, error: "BUSINESS_NAME_REQUIRED" }, { status: 400 });
    }

    const { appUserId, clerkUserId } = await ensureAppUser();

    // ✅ If client didn’t send owner fields (because user is logged in), derive them from Clerk
    let ownerName = safeTrim(body?.ownerName);
    let ownerEmail = safeTrim(body?.ownerEmail);

    if (!ownerName || !ownerEmail) {
      const u = await currentUser();
      ownerEmail = ownerEmail || (u?.emailAddresses?.[0]?.emailAddress ?? "");
      ownerName = ownerName || (u?.fullName ?? u?.firstName ?? "");
      ownerName = safeTrim(ownerName);
      ownerEmail = safeTrim(ownerEmail);
    }

    // We still enforce these, but now “logged-in path” satisfies them automatically
    if (ownerName.length < 2) {
      return NextResponse.json({ ok: false, error: "OWNER_NAME_REQUIRED" }, { status: 400 });
    }
    if (!ownerEmail.includes("@")) {
      return NextResponse.json({ ok: false, error: "OWNER_EMAIL_REQUIRED" }, { status: 400 });
    }

    let tenantId = await findTenantForClerkUser(clerkUserId);

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

      // prod tenant_members columns: tenant_id, clerk_user_id, role, status, created_at, updated_at
      await db.execute(sql`
        insert into tenant_members (tenant_id, clerk_user_id, role, status, created_at, updated_at)
        values (${tenantId}::uuid, ${clerkUserId}, 'owner', 'active', now(), now())
        on conflict do nothing
      `);

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