// src/app/invite/[code]/page.tsx
import React from "react";
import { redirect } from "next/navigation";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";
import { SignUp } from "@clerk/nextjs";

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

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function InviteUnavailable({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <main className="min-h-screen bg-gray-50 px-6 py-14 dark:bg-neutral-950">
      <div className="mx-auto max-w-xl">
        <div className="rounded-3xl border border-red-200 bg-white p-8 shadow-sm dark:border-red-900/40 dark:bg-gray-900">
          <div className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
            Invite unavailable
          </div>

          <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">
            {title}
          </h1>

          <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">{message}</p>
        </div>
      </div>
    </main>
  );
}

export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const inviteCode = safeTrim(code);

  if (!inviteCode) {
    return (
      <InviteUnavailable
        title="This invite link is not valid."
        message="The invite code is missing. Please use the full link you were sent."
      />
    );
  }

  const cfg = await getPlatformConfig();
  const now = new Date();

  const inviteRows = await db
    .select({
      id: platformOnboardingInvites.id,
      code: platformOnboardingInvites.code,
      email: platformOnboardingInvites.email,
      status: platformOnboardingInvites.status,
      expiresAt: platformOnboardingInvites.expiresAt,
      meta: platformOnboardingInvites.meta,
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

  const invite = inviteRows[0] ?? null;

  if (!invite) {
    return (
      <InviteUnavailable
        title="This invite is no longer available."
        message="The invite may be expired, revoked, already used, or incorrect."
      />
    );
  }

  const authState = await auth();
  const clerkUserId = authState?.userId ?? null;
  const user = clerkUserId ? await currentUser().catch(() => null) : null;
  const observedEmail =
    safeTrim(user?.emailAddresses?.[0]?.emailAddress) ||
    safeTrim(invite.email) ||
    "";

  const existingSessionRows = await db
    .select({
      id: platformOnboardingSessions.id,
      clerkUserId: platformOnboardingSessions.clerkUserId,
      email: platformOnboardingSessions.email,
    })
    .from(platformOnboardingSessions)
    .where(
      and(
        eq(platformOnboardingSessions.status, "active"),
        gt(platformOnboardingSessions.expiresAt, now),
        eq(platformOnboardingSessions.inviteId, invite.id),
        clerkUserId
          ? eq(platformOnboardingSessions.clerkUserId, clerkUserId)
          : observedEmail
            ? eq(platformOnboardingSessions.email, observedEmail)
            : eq(platformOnboardingSessions.inviteCode, inviteCode)
      )
    )
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
        clerkUserId: clerkUserId ? String(clerkUserId) : null,
        email: observedEmail || null,
        status: "active",
        tenantId: null,
        meta: {
          source: "invite_accept",
          onboardingMode: cfg.onboardingMode,
          inviteEmail: invite.email ?? null,
          createdFromPath: `/invite/${encodeURIComponent(inviteCode)}`,
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
  }

  if (!onboardingSessionId) {
    return (
      <InviteUnavailable
        title="We couldn’t start onboarding."
        message="The invite was valid, but we couldn’t create an onboarding session. Please try again."
      />
    );
  }

  // Signed-in users bypass Clerk sign-up entirely.
  if (clerkUserId) {
    redirect(
      `/onboarding?mode=new&onboardingSession=${encodeURIComponent(onboardingSessionId)}`
    );
  }

  const afterUrl = `/auth/after-sign-in?onboardingSession=${encodeURIComponent(onboardingSessionId)}`;

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-14">
      <SignUp afterSignInUrl={afterUrl} afterSignUpUrl={afterUrl} />
    </main>
  );
}