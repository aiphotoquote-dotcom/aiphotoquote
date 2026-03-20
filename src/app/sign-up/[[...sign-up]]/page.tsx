// src/app/sign-up/[[...sign-up]]/page.tsx
import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignUp } from "@clerk/nextjs";
import { auth, currentUser } from "@clerk/nextjs/server";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  platformOnboardingInvites,
  platformOnboardingSessions,
} from "@/lib/db/schema";
import { getPlatformConfig } from "@/lib/platform/getPlatformConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function pickStringParam(v: string | string[] | undefined): string | null {
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

function isClerkInternalPath(pathParts: string[] | undefined) {
  const parts = Array.isArray(pathParts) ? pathParts : [];
  const joined = parts.join("/").toLowerCase();

  return (
    joined.includes("sso-callback") ||
    joined.includes("verify") ||
    joined.includes("factor-one") ||
    joined.includes("factor-two") ||
    joined.includes("continue") ||
    joined.includes("callback")
  );
}

function InviteOnlyBlocked() {
  return (
    <main className="min-h-screen bg-gray-50 px-6 py-14 dark:bg-neutral-950">
      <div className="mx-auto max-w-xl">
        <div className="rounded-3xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
            Invite required
          </div>

          <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">
            Onboarding is currently invite-only.
          </h1>

          <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
            AI Photo Quote is onboarding new businesses by invitation at the moment.
            You’ll need a valid invite link or invite code to continue.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="mailto:inviteme@aiphotoquote.com?subject=AI%20Photo%20Quote%20Invite%20Request"
              className="inline-flex items-center justify-center rounded-xl bg-gray-900 px-5 py-3 text-sm font-extrabold text-white hover:opacity-90 dark:bg-white dark:text-black"
            >
              Request an invite
            </a>

            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-950"
            >
              Return home
            </Link>
          </div>

          <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-600 dark:border-gray-800 dark:bg-black dark:text-gray-300">
            If you already received an invite, use the full invite link you were sent.
          </div>
        </div>
      </div>
    </main>
  );
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ "sign-up"?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const cfg = await getPlatformConfig();
  const sp = await searchParams;
  const routeParams = await params;

  const authState = await auth();
  const userId = authState?.userId ?? null;
  const user = userId ? await currentUser().catch(() => null) : null;
  const signedInEmail = safeTrim(user?.emailAddresses?.[0]?.emailAddress);

  const inviteCode = pickStringParam(sp.invite);
  const onboardingSessionId = pickStringParam(sp.onboardingSession);

  const pathParts = routeParams?.["sign-up"] ?? [];
  const isInternalClerkPath = isClerkInternalPath(pathParts);

  const now = new Date();

  let hasValidOnboardingSession = false;
  if (onboardingSessionId) {
    const rows = await db
      .select({
        id: platformOnboardingSessions.id,
      })
      .from(platformOnboardingSessions)
      .where(
        and(
          eq(platformOnboardingSessions.id, onboardingSessionId),
          eq(platformOnboardingSessions.status, "active"),
          gt(platformOnboardingSessions.expiresAt, now)
        )
      )
      .limit(1);

    hasValidOnboardingSession = rows.length > 0;
  }

  let hasValidLegacyInvite = false;
  if (inviteCode) {
    const rows = await db
      .select({
        id: platformOnboardingInvites.id,
      })
      .from(platformOnboardingInvites)
      .where(
        and(
          eq(platformOnboardingInvites.code, inviteCode),
          eq(platformOnboardingInvites.status, "pending"),
          or(
            isNull(platformOnboardingInvites.expiresAt),
            gt(platformOnboardingInvites.expiresAt, now)
          )
        )
      )
      .limit(1);

    hasValidLegacyInvite = rows.length > 0;
  }

  // 1) Direct explicit recovery
  if (!isInternalClerkPath && userId && hasValidOnboardingSession && onboardingSessionId) {
    await db.execute(sql`
      update platform_onboarding_sessions
      set
        clerk_user_id = ${String(userId)},
        email = ${signedInEmail || null},
        updated_at = now()
      where id = ${onboardingSessionId}::uuid
    `);

    redirect(`/onboarding?mode=new&onboardingSession=${encodeURIComponent(onboardingSessionId)}`);
  }

  // 2) Explicit invite context should go back through after-sign-in
  if (!isInternalClerkPath && userId && hasValidLegacyInvite && inviteCode) {
    redirect(`/auth/after-sign-in?invite=${encodeURIComponent(inviteCode)}`);
  }

  // 3) Signed-in recovery only for sessions already bound to this user
  if (!isInternalClerkPath && userId && !hasValidOnboardingSession && !hasValidLegacyInvite) {
    const recoveryRows = await db
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
            eq(platformOnboardingSessions.clerkUserId, userId),
            signedInEmail
              ? eq(platformOnboardingSessions.email, signedInEmail)
              : eq(platformOnboardingSessions.clerkUserId, userId)
          )
        )
      )
      .orderBy(desc(platformOnboardingSessions.createdAt))
      .limit(1);

    const recovered = recoveryRows[0] ?? null;
    if (recovered?.id) {
      redirect(`/onboarding?mode=new&onboardingSession=${encodeURIComponent(String(recovered.id))}`);
    }
  }

  // 4) No explicit invite context and no bound session -> block in invite_only mode
  if (
    cfg.onboardingMode === "invite_only" &&
    !hasValidOnboardingSession &&
    !hasValidLegacyInvite &&
    !isInternalClerkPath
  ) {
    return <InviteOnlyBlocked />;
  }

  const afterUrl =
    hasValidOnboardingSession && onboardingSessionId
      ? `/auth/after-sign-in?onboardingSession=${encodeURIComponent(onboardingSessionId)}`
      : hasValidLegacyInvite && inviteCode
        ? `/auth/after-sign-in?invite=${encodeURIComponent(inviteCode)}`
        : "/auth/after-sign-in";

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-14">
      <SignUp afterSignInUrl={afterUrl} afterSignUpUrl={afterUrl} />
    </main>
  );
}