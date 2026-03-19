// src/app/invite/[code]/page.tsx
import React from "react";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeCode(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function InviteBlocked() {
  return (
    <main className="min-h-screen bg-gray-50 px-6 py-14 dark:bg-neutral-950">
      <div className="mx-auto max-w-xl">
        <div className="rounded-3xl border border-red-200 bg-white p-8 shadow-sm dark:border-red-900/40 dark:bg-gray-900">
          <div className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
            Invalid invite
          </div>

          <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">
            This invite link is not valid.
          </h1>

          <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
            The invite link is missing a valid code. Please use the full link you were sent.
          </p>
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
  const inviteCode = safeCode(code);
  const { userId } = await auth();

  if (!inviteCode) {
    return <InviteBlocked />;
  }

  // ✅ Force invited onboarding into NEW tenant mode.
  if (userId) {
    redirect(`/onboarding?mode=new&invite=${encodeURIComponent(inviteCode)}`);
  }

  redirect(`/sign-up?invite=${encodeURIComponent(inviteCode)}`);
}