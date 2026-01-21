// src/app/admin/setup/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminSetupIndex() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // ✅ Make /admin/setup land on onboarding
  // Change this path if your onboarding page is different.
  redirect("/admin/setup/onboarding");
}