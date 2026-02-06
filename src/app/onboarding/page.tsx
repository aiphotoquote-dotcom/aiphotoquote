// src/app/onboarding/page.tsx
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function OnboardingRedirectPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const qs = new URLSearchParams();

  for (const [k, v] of Object.entries(searchParams ?? {})) {
    if (typeof v === "string" && v.trim()) qs.set(k, v);
    else if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string" && item.trim()) qs.append(k, item);
      }
    }
  }

  const url = qs.toString() ? `/onboarding/wizard?${qs.toString()}` : `/onboarding/wizard`;
  redirect(url);
}