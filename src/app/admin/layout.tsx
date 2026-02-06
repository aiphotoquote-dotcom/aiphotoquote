import React from "react";

import AdminTopNav from "@/components/admin/AdminTopNav";
import AdminTenantGateShell from "@/components/tenant/AdminTenantGateShell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-gray-900 dark:bg-neutral-950 dark:text-gray-100">
      <AdminTopNav />
      <AdminTenantGateShell>{children}</AdminTenantGateShell>
    </div>
  );
}