// src/app/onboarding/wizard/page.tsx
import React from "react";
import { redirect } from "next/navigation";

import OnboardingWizard from "./OnboardingWizard";
import { getPlatformConfig } from "@/lib/platform/getPlatformConfig";
import { db } from "@/lib/db/client";
import { platformOnboardingSessions } from "@/lib/db/schema";
import { and, eq, gt } from "drizzle-orm";

export const dynamic = "force-dynamic";

function pickParam(v: string | string[] | undefined): string | null {
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : null;
  }

  if (Array.isArray(v)) {
    const first = v.find((x) => typeof x === "string" && x.trim());
    return first ? first.trim() : null;
  }

  return null;
}

export default async function OnboardingWizardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const cfg = await getPlatformConfig();
  const sp = await searchParams;

  const inviteCode = pickParam(sp.invite);
  const onboardingSessionId = pickParam(sp.onboardingSession);

  let hasValidOnboardingSession = false;

  if (onboardingSessionId) {
    const now = new Date();

    const rows = await db
      .select({ id: platformOnboardingSessions.id })
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

  // In invite-only mode, allow onboarding if either:
  // - a valid onboarding session exists, or
  // - a legacy invite code is still present
  if (
    cfg.onboardingMode === "invite_only" &&
    !hasValidOnboardingSession &&
    !inviteCode
  ) {
    redirect("/sign-up");
  }

  return <OnboardingWizard />;
}