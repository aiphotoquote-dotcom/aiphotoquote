// src/app/api/onboarding/state/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";

import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ONBOARDING_TENANT_COOKIE = "onboarding_tenant_id";

type Mode = "new" | "update";

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

function parseMode(req: Request): Mode {
  try {
    const u = new URL(req.url);
    const m = safeTrim(u.searchParams.get("mode")).toLowerCase();
    return m === "update" ? "update" : "new";
  } catch {
    return "new";
  }
}

function parseTenantId(req: Request): string {
  try {
    const u = new URL(req.url);
    return safeTrim(u.searchParams.get("tenantId"));
  } catch {
    return "";
  }
}

/**
 * Ensure we have an app_users row for this Clerk user.
 * IMPORTANT: use ON CONFLICT (auth_provider, auth_subject) because your DB has a UNIQUE INDEX.
 */
async function ensureAppUser(): Promise<{ appUserId: string; clerkUserId: string; signedIn: true }> {
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

  return { appUserId, clerkUserId, signedIn: true };
}

/**
 * Ensure the user is a member of tenantId (authorization gate for update flows).
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
 * Resolve tenant context for onboarding:
 * - mode=update => tenantId must be provided (query), and membership is enforced.
 * - mode=new (default) => use onboarding cookie if present; otherwise no tenant until Step 1 creates one.
 *
 * NOTE: We intentionally DO NOT fallback to "first tenant" anymore for onboarding new flows.
 */
async function resolveTenantId(req: Request, clerkUserId: string): Promise<{ mode: Mode; tenantId: string | null }> {
  const mode = parseMode(req);

  if (mode === "update") {
    const tenantId = parseTenantId(req);
    if (!tenantId) throw new Error("TENANT_ID_REQUIRED");
    await requireMembership(clerkUserId, tenantId);
    return { mode, tenantId };
  }

  // mode=new
  const jar = await cookies();
  const cookieTenantId = safeTrim(jar.get(ONBOARDING_TENANT_COOKIE)?.value ?? "");
  if (!cookieTenantId) return { mode, tenantId: null };

  // If cookie is set, ensure membership (it should be, but don’t trust it blindly)
  await requireMembership(clerkUserId, cookieTenantId);
  return { mode, tenantId: cookieTenantId };
}

export async function GET(req: Request) {
  try {
    const { clerkUserId, signedIn } = await ensureAppUser();

    const { mode, tenantId } = await resolveTenantId(req, clerkUserId);

    if (!tenantId) {
      return NextResponse.json(
        {
          ok: true,
          mode,
          signedIn,
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
        mode,
        signedIn,
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
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : msg === "TENANT_ID_REQUIRED" ? 400 : 500;
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

    // NEW behavior:
    // - mode=update => updates the specified tenantId (must be member)
    // - mode=new (default) => ALWAYS creates a new tenant (or continues the cookie tenant if already created)
    const reqMode = safeTrim(body?.mode).toLowerCase();
    const mode: Mode = reqMode === "update" ? "update" : "new";
    const requestedTenantId = safeTrim(body?.tenantId);

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

    // Resolve target tenant
    let tenantId: string | null = null;

    if (mode === "update") {
      if (!requestedTenantId) return NextResponse.json({ ok: false, error: "TENANT_ID_REQUIRED" }, { status: 400 });
      await requireMembership(clerkUserId, requestedTenantId);
      tenantId = requestedTenantId;
    } else {
      // mode=new: if we already created a tenant for this onboarding session, reuse it
      const jar = await cookies();
      const cookieTenantId = safeTrim(jar.get(ONBOARDING_TENANT_COOKIE)?.value ?? "");
      if (cookieTenantId) {
        await requireMembership(clerkUserId, cookieTenantId);
        tenantId = cookieTenantId;
      }
    }

    // Create new tenant if needed (mode=new, no cookie tenant yet)
    if (!tenantId && mode === "new") {
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
    }

    if (!tenantId) throw new Error("NO_TENANT");

    // Update identity (both update + new flows)
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

    // Persist website to tenant_onboarding so analyze-website can read it
    await db.execute(sql`
      insert into tenant_onboarding (tenant_id, website, current_step, completed, created_at, updated_at)
      values (${tenantId}::uuid, ${website || null}, 2, false, now(), now())
      on conflict (tenant_id) do update
      set website = excluded.website,
          current_step = greatest(tenant_onboarding.current_step, 2),
          updated_at = now()
    `);

    const res = NextResponse.json({ ok: true, tenantId, mode }, { status: 200 });

    // For mode=new, lock the session to this tenant via cookie
    if (mode === "new") {
      res.cookies.set(ONBOARDING_TENANT_COOKIE, tenantId, {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
        maxAge: 60 * 60 * 24 * 7, // 7 days
      });
    }

    return res;
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status =
      msg === "UNAUTHENTICATED"
        ? 401
        : msg === "FORBIDDEN_TENANT"
        ? 403
        : msg === "TENANT_ID_REQUIRED"
        ? 400
        : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}