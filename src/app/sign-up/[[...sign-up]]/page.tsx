// src/app/sign-up/[[...sign-up]]/page.tsx
import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignUp } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";

import { getPlatformConfig } from "@/lib/platform/getPlatformConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pickInviteParam(
  searchParams: Record<string, string | string[] | undefined>
): string | null {
  const raw = searchParams?.invite;

  if (typeof raw === "string") {
    const v = raw.trim();
    return v ? v : null;
  }

  if (Array.isArray(raw)) {
    const first = raw.find((x) => typeof x === "string" && x.trim());
    return first ? first.trim() : null;
  }

  return null;
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
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const cfg = await getPlatformConfig();
  const sp = await searchParams;
  const inviteCode = pickInviteParam(sp);
  const { userId } = await auth();

  // ✅ Signed-in user with an invite should skip Clerk sign-up
  // and go straight into invited onboarding flow.
  if (userId && inviteCode) {
    redirect(`/onboarding?mode=new&invite=${encodeURIComponent(inviteCode)}`);
  }

  // ✅ Signed-in user without an invite just goes to normal post-auth flow.
  if (userId) {
    redirect("/auth/after-sign-in");
  }

  // ✅ In invite-only mode, block only when no invite is present.
  if (cfg.onboardingMode === "invite_only" && !inviteCode) {
    return <InviteOnlyBlocked />;
  }

  // ✅ IMPORTANT:
  // Do NOT redirect invite-bearing sign-up requests back to /invite/[code].
  // That caused the redirect loop with the dedicated invite page.
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-14">
      <SignUp
        afterSignInUrl={inviteCode ? `/auth/after-sign-in?invite=${encodeURIComponent(inviteCode)}` : "/auth/after-sign-in"}
        afterSignUpUrl={inviteCode ? `/auth/after-sign-in?invite=${encodeURIComponent(inviteCode)}` : "/auth/after-sign-in"}
      />
    </main>
  );
}