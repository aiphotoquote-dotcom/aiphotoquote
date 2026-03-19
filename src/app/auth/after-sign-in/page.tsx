// src/app/auth/after-sign-in/page.tsx
import { redirect } from "next/navigation";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";

import { db } from "@/lib/db/client";
import {
  platformOnboardingInvites,
  platformOnboardingSessions,
} from "@/lib/db/schema";
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

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
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
  const user = await currentUser().catch(() => null);
  const email = safeTrim(user?.emailAddresses?.[0]?.emailAddress);
  const now = new Date();

  // 1) Explicit onboarding session always wins.
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
      await db.execute(sql`
        update platform_onboarding_sessions
        set
          clerk_user_id = ${clerkUserId},
          email = ${email || null},
          updated_at = now()
        where id = ${explicitSessionId}::uuid
      `);

      redirect(`/onboarding?mode=new&onboardingSession=${encodeURIComponent(explicitSessionId)}`);
    }
  }

  // 2) Explicit invite is the durable recovery key.
  if (explicitInvite) {
    const inviteRows = await db
      .select({
        id: platformOnboardingInvites.id,
        code: platformOnboardingInvites.code,
      })
      .from(platformOnboardingInvites)
      .where(
        and(
          eq(platformOnboardingInvites.code, explicitInvite),
          eq(platformOnboardingInvites.status, "pending"),
          or(
            isNull(platformOnboardingInvites.expiresAt),
            gt(platformOnboardingInvites.expiresAt, now)
          )
        )
      )
      .limit(1);

    const invite = inviteRows[0] ?? null;

    if (invite?.id) {
      const existingSessionRows = await db
        .select({
          id: platformOnboardingSessions.id,
          createdAt: platformOnboardingSessions.createdAt,
        })
        .from(platformOnboardingSessions)
        .where(
          and(
            eq(platformOnboardingSessions.inviteId, invite.id),
            eq(platformOnboardingSessions.status, "active"),
            gt(platformOnboardingSessions.expiresAt, now)
          )
        )
        .orderBy(desc(platformOnboardingSessions.createdAt))
        .limit(1);

      let onboardingSessionId = existingSessionRows[0]?.id
        ? String(existingSessionRows[0].id)
        : "";

      if (!onboardingSessionId) {
        const inserted = await db
          .insert(platformOnboardingSessions)
          .values({
            inviteId: invite.id,
            inviteCode: String(invite.code),
            clerkUserId: String(clerkUserId),
            email: email || null,
            status: "active",
            tenantId: null,
            meta: {
              source: "after_sign_in_invite_recovery",
              recoveredFromInvite: String(invite.code),
            },
            expiresAt: addMinutes(now, 30),
            consumedAt: null,
            cancelledAt: null,
            createdAt: now,
            updatedAt: now,
          })
          .returning({
            id: platformOnboardingSessions.id,
          });

        onboardingSessionId = inserted[0]?.id ? String(inserted[0].id) : "";
      } else {
        await db.execute(sql`
          update platform_onboarding_sessions
          set
            clerk_user_id = ${clerkUserId},
            email = ${email || null},
            updated_at = now()
          where id = ${onboardingSessionId}::uuid
        `);
      }

      if (onboardingSessionId) {
        redirect(`/onboarding?mode=new&onboardingSession=${encodeURIComponent(onboardingSessionId)}`);
      }
    }
  }

  // 3) Recovery path for explicit session being dropped but user already bound.
  const recoveredRows = await db
    .select({
      id: platformOnboardingSessions.id,
      createdAt: platformOnboardingSessions.createdAt,
    })
    .from(platformOnboardingSessions)
    .where(
      and(
        eq(platformOnboardingSessions.status, "active"),
        gt(platformOnboardingSessions.expiresAt, now),
        or(
          eq(platformOnboardingSessions.clerkUserId, clerkUserId),
          email
            ? eq(platformOnboardingSessions.email, email)
            : eq(platformOnboardingSessions.clerkUserId, clerkUserId)
        )
      )
    )
    .orderBy(desc(platformOnboardingSessions.createdAt))
    .limit(1);

  const recovered = recoveredRows[0] ?? null;
  if (recovered?.id) {
    redirect(`/onboarding?mode=new&onboardingSession=${encodeURIComponent(String(recovered.id))}`);
  }

  // 4) Normal tenant routing fallback.
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