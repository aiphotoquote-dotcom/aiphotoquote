// src/app/sign-up/page.tsx
import React from "react";
import { SignUp } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  platformConfig,
  platformOnboardingInvites,
  platformOnboardingSessions,
} from "@/lib/db/schema";

export const dynamic = "force-dynamic";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

async function getConfig() {
  const rows = await db
    .select()
    .from(platformConfig)
    .limit(1);

  return rows[0] ?? null;
}

function InviteRequiredScreen() {
  return (
    <main className="min-h-screen bg-gray-50 px-6 py-14 dark:bg-neutral-950">
      <div className="mx-auto max-w-xl">
        <div className="rounded-3xl border border-gray-200 bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-gray-900">

          <div className="inline-flex items-center rounded-full border border-yellow-200 bg-yellow-50 px-3 py-1 text-xs font-semibold text-yellow-800 dark:border-yellow-900/40 dark:bg-yellow-950/30 dark:text-yellow-200">
            Invite required
          </div>

          <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">
            Onboarding is currently invite-only.
          </h1>

          <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
            AI Photo Quote is onboarding new businesses by invitation at the moment.
            You’ll need a valid invite link or invite code to continue.
          </p>

          <div className="mt-6 flex gap-3">
            <a
              href="/"
              className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              Return home
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; onboardingSession?: string }>;
}) {

  const params = await searchParams;

  const invite = safeTrim(params?.invite);
  const onboardingSession = safeTrim(params?.onboardingSession);

  const cfg = await getConfig();

  if (!cfg) {
    return <InviteRequiredScreen />;
  }

  /**
   * OPEN onboarding
   */
  if (cfg.onboardingMode === "open") {
    return <SignUp />;
  }

  /**
   * Invite-only mode
   */
  if (cfg.onboardingMode === "invite_only") {

    /**
     * NEW: session-based onboarding
     */
    if (onboardingSession) {

      const rows = await db
        .select({
          id: platformOnboardingSessions.id,
          status: platformOnboardingSessions.status,
        })
        .from(platformOnboardingSessions)
        .where(eq(platformOnboardingSessions.id, onboardingSession))
        .limit(1);

      const session = rows[0] ?? null;

      if (session && session.status === "active") {
        return <SignUp />;
      }
    }

    /**
     * Legacy invite query support
     */
    if (invite) {
      const rows = await db
        .select({
          id: platformOnboardingInvites.id,
        })
        .from(platformOnboardingInvites)
        .where(eq(platformOnboardingInvites.code, invite))
        .limit(1);

      if (rows.length > 0) {
        return <SignUp />;
      }
    }

    return <InviteRequiredScreen />;
  }

  return <SignUp />;
}