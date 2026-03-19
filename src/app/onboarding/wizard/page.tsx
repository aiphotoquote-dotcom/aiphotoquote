// src/app/onboarding/wizard/page.tsx
import React from "react";
import { redirect } from "next/navigation";

import OnboardingWizard from "./OnboardingWizard";
import { getPlatformConfig } from "@/lib/platform/getPlatformConfig";

export const dynamic = "force-dynamic";

function pickInvite(searchParams: Record<string, string | string[] | undefined>) {
  const raw = searchParams?.invite;

  if (typeof raw === "string" && raw.trim()) return raw.trim();

  if (Array.isArray(raw)) {
    const v = raw.find((x) => typeof x === "string" && x.trim());
    return v ? v.trim() : null;
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
  const inviteCode = pickInvite(sp);

  // If invite-only mode and no invite code, send them back to sign-up
  if (cfg.onboardingMode === "invite_only" && !inviteCode) {
    redirect("/sign-up");
  }

  return <OnboardingWizard />;
}