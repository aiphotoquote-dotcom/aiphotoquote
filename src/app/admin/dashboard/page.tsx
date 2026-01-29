// src/app/admin/dashboard/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import AdminDashboardClient from "@/components/admin/AdminDashboardClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readActiveTenantIdFromCookies(): Promise<string | null> {
  const jar = await cookies();
  return (
    jar.get("activeTenantId")?.value ||
    jar.get("active_tenant_id")?.value ||
    jar.get("tenantId")?.value ||
    jar.get("tenant_id")?.value ||
    null
  );
}

export default async function AdminDashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // ✅ If no tenant cookie yet, force the bootstrap page.
  const activeTenantId = await readActiveTenantIdFromCookies();
  if (!activeTenantId) redirect("/admin/select-tenant");

  return <AdminDashboardClient />;
}