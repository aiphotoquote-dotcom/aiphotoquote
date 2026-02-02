// src/app/api/onboarding/state/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";

import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OnboardingMode =
  | "new_user_new_tenant"
  | "existing_user_new_tenant"
  | "existing_user_existing_tenant";

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
 * Ensure the portable app_user exists for this Clerk user.
 * IMPORTANT: Use ON CONFLICT to avoid "already exists" crashes in race conditions.
 */
async function ensureAppUser(): Promise<{
  appUserId: string;
  user: { name: string | null; email: string | null };
}> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHENTICATED");

  const u = await currentUser();
  const email = u?.emailAddresses?.[0]?.emailAddress ?? null;
  const name = u?.fullName ?? u?.firstName ?? null;

  const upsert = await db.execute(sql`
    insert into app_users (id, auth_provider, auth_subject, email, name, created_at, updated_at)
    values (gen_random_uuid(), 'clerk', ${userId}, ${email}, ${name}, now(), now())
    on conflict on constraint app_users_provider_subject_uq
    do update set
      email = coalesce(excluded.email, app_users.email),
      name = coalesce(excluded.name, app_users.name),
      updated_at = now()
    returning id
  `);

  const row: any = (upsert as any)?.rows?.[0] ?? null;
  const appUserId = row?.id ? String(row.id) : null;
  if (!appUserId) throw new Error("FAILED_TO_CREATE_APP_USER");

  return { appUserId, user: { name, email } };
}

async function listTenantsForUser(appUserId: string): Promise<Array<{ tenantId: string; tenantName: string | null }>> {
  const r = await db.execute(sql`
    select tm.tenant_id, t.name as tenant_name
    from tenant_members tm
    join tenants t on t.id = tm.tenant_id
    where tm.user_id = ${appUserId}::uuid
    order by tm.created_at asc
  `);

  const rows: any[] = (r as any)?.rows ?? [];
  return rows
    .map((x) => ({
      tenantId: x?.tenant_id ? String(x.tenant_id) : "",
      tenantName: x?.tenant_name ?? null,
    }))
    .filter((x) => Boolean(x.tenantId));
}

async function getOnboardingRow(tenantId: string) {
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

  return {
    tenantName: row?.tenant_name ?? null,
    currentStep: row?.current_step ?? 1,
    completed: row?.completed ?? false,
    website: row?.website ?? null,
    aiAnalysis: row?.ai_analysis ?? null,
  };
}

/**
 * Entry point rules:
 * - existing user + existing tenant: continue onboarding for earliest tenant (v1 behavior)
 * - existing user + no tenant: wizard will create tenant on POST step 1
 */
export async function GET() {
  try {
    const { appUserId, user } = await ensureAppUser();
    const tenants = await listTenantsForUser(appUserId);

    if (!tenants.length) {
      const onboardingMode: OnboardingMode = "new_user_new_tenant";
      return NextResponse.json(
        {
          ok: true,
          onboardingMode,
          user,
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

    // v1: pick earliest tenant membership as "active onboarding tenant"
    const tenantId = tenants[0].tenantId;

    const o = await getOnboardingRow(tenantId);

    const onboardingMode: OnboardingMode = "existing_user_existing_tenant";

    return NextResponse.json(
      {
        ok: true,
        onboardingMode,
        user,
        tenantId,
        tenantName: o.tenantName,
        currentStep: o.currentStep,
        completed: o.completed,
        website: o.website,
        aiAnalysis: o.aiAnalysis,
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

    const { appUserId } = await ensureAppUser();

    // If user already has a tenant, treat this POST as "update business identity" for that tenant (v1).
    const tenants = await listTenantsForUser(appUserId);
    let tenantId: string | null = tenants.length ? tenants[0].tenantId : null;

    // Create tenant if first time
    if (!tenantId) {
      const baseSlug = slugify(businessName);
      const slug = `${baseSlug}-${Math.random().toString(16).slice(2, 6)}`;

      const tIns = await db.execute(sql`
        insert into tenants (id, name, slug, owner_user_id, created_at)
        values (gen_random_uuid(), ${businessName}, ${slug}, ${appUserId}::uuid, now())
        returning id
      `);

      const trow: any = (tIns as any)?.rows?.[0] ?? null;
      if (!trow?.id) throw new Error("FAILED_TO_CREATE_TENANT");
      tenantId = String(trow.id);

      await db.execute(sql`
        insert into tenant_members (id, tenant_id, user_id, role, created_at)
        values (gen_random_uuid(), ${tenantId}::uuid, ${appUserId}::uuid, 'owner', now())
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