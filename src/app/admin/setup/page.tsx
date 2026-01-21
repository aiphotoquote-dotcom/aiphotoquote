// src/app/admin/setup/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminSetupPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Setup "hub" default: send to onboarding flow entry
  // (Choose one canonical landing so /admin/setup never 404s.)
  redirect("/admin/setup/ai-policy");
}