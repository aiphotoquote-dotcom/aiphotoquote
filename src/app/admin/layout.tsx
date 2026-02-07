// src/app/admin/layout.tsx
import React from "react";

import AdminTenantGateShell from "@/components/tenant/AdminTenantGateShell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminTenantGateShell>{children}</AdminTenantGateShell>;
}