// src/lib/admin/quotes/getActiveTenant.ts
import { and, eq, sql } from "drizzle-orm";
import type { cookies } from "next/headers";

import { db } from "@/lib/db/client";
import { tenantMembers, tenants } from "@/lib/db/schema";

function getCookieTenantId(jar: Awaited<ReturnType<typeof cookies>>) {
  const candidates = [
    jar.get("activeTenantId")?.value,
    jar.get("active_tenant_id")?.value,
    jar.get("tenantId")?.value,
    jar.get("tenant_id")?.value,
    jar.get("apq_activeTenantId")?.value,
    jar.get("apq_active_tenant_id")?.value,
    jar.get("__Host-activeTenantId")?.value,
    jar.get("__Host-active_tenant_id")?.value,
  ].filter(Boolean) as string[];

  return candidates[0] || null;
}

export async function resolveActiveTenantId(args: {
  jar: Awaited<ReturnType<typeof cookies>>;
  userId: string;
}): Promise<string | null> {
  const { jar, userId } = args;

  let tenantIdMaybe = getCookieTenantId(jar);

  // If cookie tenant exists, validate membership
  if (tenantIdMaybe) {
    const membership = await db
      .select({ ok: sql<number>`1` })
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.tenantId, tenantIdMaybe),
          eq(tenantMembers.clerkUserId, userId),
          eq(tenantMembers.status, "active")
        )
      )
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!membership?.ok) tenantIdMaybe = null;
  }

  // Fallback: first owned tenant (legacy back-compat)
  if (!tenantIdMaybe) {
    const t = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.ownerClerkUserId, userId))
      .limit(1)
      .then((r) => r[0] ?? null);

    tenantIdMaybe = t?.id ?? null;
  }

  return tenantIdMaybe ?? null;
}