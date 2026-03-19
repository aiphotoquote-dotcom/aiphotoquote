// src/app/onboarding/page.tsx
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function OnboardingRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const qs = new URLSearchParams();

  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string" && v.trim()) {
      qs.set(k, v);
    } else if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string" && item.trim()) {
          qs.append(k, item);
        }
      }
    }
  }

  const url = qs.toString() ? `/onboarding/wizard?${qs.toString()}` : `/onboarding/wizard`;
  redirect(url);
}