// src/app/admin/dashboard/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import AdminDashboardClient from "@/components/admin/AdminDashboardClient";
import TenantGate from "@/components/tenant/TenantGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <TenantGate title="Tenant required" subtitle="Select a tenant to continue into the admin dashboard.">
      <AdminDashboardClient />
    </TenantGate>
  );
}