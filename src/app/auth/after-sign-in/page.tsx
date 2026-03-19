// src/app/auth/after-sign-in/page.tsx
import { redirect } from "next/navigation";
import { and, desc, eq, gt, or } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";

import { db } from "@/lib/db/client";
import { platformOnboardingSessions } from "@/lib/db/schema";
import { requireAppUserId } from "@/lib/auth/requireAppUser";
import { readActiveTenantIdFromCookies } from "@/lib/tenant/activeTenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function pickParam(v: string | string[] | undefined): string | null {
  if (typeof v === "string") {
    const s = safeTrim(v);
    return s || null;
  }
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = safeTrim(item);
      if (s) return s;
    }
  }
  return null;
}

export default async function AfterSignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const explicitSessionId = pickParam(sp.onboardingSession);
  const explicitInvite = pickParam(sp.invite);

  const authState = await auth();
  const clerkUserId = authState?.userId ?? null;

  if (!clerkUserId) {
    redirect("/sign-in");
  }

  // Keep your app user layer warm/consistent
  await requireAppUserId();

  const user = await currentUser().catch(() => null);
  const email = safeTrim(user?.emailAddresses?.[0]?.emailAddress);
  const now = new Date();

  // 1) Highest priority: explicit onboarding session from query
  if (explicitSessionId) {
    const rows = await db
      .select({
        id: platformOnboardingSessions.id,
      })
      .from(platformOnboardingSessions)
      .where(
        and(
          eq(platformOnboardingSessions.id, explicitSessionId),
          eq(platformOnboardingSessions.status, "active"),
          gt(platformOnboardingSessions.expiresAt, now)
        )
      )
      .limit(1);

    if (rows.length > 0) {
      redirect(
        `/onboarding?mode=new&onboardingSession=${encodeURIComponent(explicitSessionId)}`
      );
    }
  }

  // 2) Legacy fallback while old invite query links still exist
  if (explicitInvite) {
    redirect(`/onboarding?mode=new&invite=${encodeURIComponent(explicitInvite)}`);
  }

  // 3) Strong fallback: find the newest active onboarding session for this user
  //    by clerk_user_id OR email
  const sessionRows = await db
    .select({
      id: platformOnboardingSessions.id,
      clerkUserId: platformOnboardingSessions.clerkUserId,
      email: platformOnboardingSessions.email,
      createdAt: platformOnboardingSessions.createdAt,
    })
    .from(platformOnboardingSessions)
    .where(
      and(
        eq(platformOnboardingSessions.status, "active"),
        gt(platformOnboardingSessions.expiresAt, now),
        or(
          eq(platformOnboardingSessions.clerkUserId, clerkUserId),
          email ? eq(platformOnboardingSessions.email, email) : eq(platformOnboardingSessions.clerkUserId, clerkUserId)
        )
      )
    )
    .orderBy(desc(platformOnboardingSessions.createdAt))
    .limit(1);

  const activeSession = sessionRows[0] ?? null;

  if (activeSession?.id) {
    redirect(
      `/onboarding?mode=new&onboardingSession=${encodeURIComponent(String(activeSession.id))}`
    );
  }

  // 4) Normal tenant routing fallback
  const activeTenantId = await readActiveTenantIdFromCookies();

  // If a tenant is already active, go straight to admin
  if (activeTenantId) {
    redirect("/admin");
  }

  // Otherwise inspect tenant memberships for this clerk user
  const memberships = await db.execute(`
    select tenant_id
    from tenant_members
    where clerk_user_id = '${clerkUserId.replace(/'/g, "''")}'
      and (status is null or status = 'active')
    limit 2
  ` as any);

  const rows: any[] =
    (memberships as any)?.rows ??
    (Array.isArray(memberships) ? memberships : []);

  const tenantCount = rows.length;

  if (tenantCount === 0) {
    redirect("/onboarding");
  }

  if (tenantCount === 1) {
    redirect("/admin");
  }

  redirect("/admin/select-tenant");
}