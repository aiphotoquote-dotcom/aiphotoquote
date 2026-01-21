// src/app/admin/dashboard/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // TEMP: reuse existing dashboard until we fully migrate it under /admin
  redirect("/dashboard");
}