// src/app/auth/after-sign-in/page.tsx
import { redirect } from "next/navigation";
import { and, eq, gt, sql } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";

import { db } from "@/lib/db/client";
import { platformOnboardingSessions } from "@/lib/db/schema";
import { requireAppUserId } from "@/lib/auth/requireAppUser";
import { readActiveTenantIdFromCookies } from "@/lib/tenant/activeTenant";
import { getPlatformConfig } from "@/lib/platform/getPlatformConfig";

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

  await requireAppUserId();

  const cfg = await getPlatformConfig();
  await currentUser().catch(() => null);
  const now = new Date();

  // 1) Explicit onboarding session in query always wins.
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
      redirect(`/onboarding?mode=new&onboardingSession=${encodeURIComponent(explicitSessionId)}`);
    }
  }

  // 2) Legacy explicit invite query fallback.
  if (explicitInvite) {
    redirect(`/onboarding?mode=new&invite=${encodeURIComponent(explicitInvite)}`);
  }

  // 3) Normal tenant routing fallback.
  const activeTenantId = await readActiveTenantIdFromCookies();
  if (activeTenantId) {
    redirect("/admin");
  }

  const membershipRows = await db.execute(sql`
    select tenant_id
    from tenant_members
    where clerk_user_id = ${clerkUserId}
      and (status is null or status = 'active')
    limit 2
  `);

  const rows: any[] =
    (membershipRows as any)?.rows ??
    (Array.isArray(membershipRows) ? membershipRows : []);

  const tenantCount = rows.length;

  if (tenantCount === 0) {
    // ✅ Critical loop breaker:
    // In invite_only mode, zero-tenant users should land on the blocked sign-up page,
    // not on "/" where homepage auth logic may bounce them back here.
    if (cfg.onboardingMode === "invite_only") {
      redirect("/sign-up");
    }

    redirect("/onboarding");
  }

  if (tenantCount === 1) {
    redirect("/admin");
  }

  redirect("/admin/select-tenant");
}