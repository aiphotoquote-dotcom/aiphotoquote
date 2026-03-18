// src/lib/platform/getOnboardingInvites.ts
import { desc } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { platformOnboardingInvites } from "@/lib/db/schema";

export type PlatformOnboardingInvite = {
  id: string;
  code: string;
  email: string | null;
  createdBy: string;
  status: "pending" | "used" | "revoked" | "expired";
  usedByTenantId: string | null;
  usedAt: Date | null;
  expiresAt: Date | null;
  meta: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
};

export async function getOnboardingInvites(): Promise<PlatformOnboardingInvite[]> {
  const rows = await db
    .select({
      id: platformOnboardingInvites.id,
      code: platformOnboardingInvites.code,
      email: platformOnboardingInvites.email,
      createdBy: platformOnboardingInvites.createdBy,
      status: platformOnboardingInvites.status,
      usedByTenantId: platformOnboardingInvites.usedByTenantId,
      usedAt: platformOnboardingInvites.usedAt,
      expiresAt: platformOnboardingInvites.expiresAt,
      meta: platformOnboardingInvites.meta,
      createdAt: platformOnboardingInvites.createdAt,
      updatedAt: platformOnboardingInvites.updatedAt,
    })
    .from(platformOnboardingInvites)
    .orderBy(desc(platformOnboardingInvites.createdAt))
    .limit(200);

  return rows.map((r) => ({
    id: String(r.id),
    code: String(r.code),
    email: r.email ? String(r.email) : null,
    createdBy: String(r.createdBy),
    status: String(r.status) as PlatformOnboardingInvite["status"],
    usedByTenantId: r.usedByTenantId ? String(r.usedByTenantId) : null,
    usedAt: r.usedAt ?? null,
    expiresAt: r.expiresAt ?? null,
    meta: r.meta ?? {},
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}