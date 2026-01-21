// src/app/admin/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Admin landing: go to dashboard after login
  redirect("/admin/dashboard");
}