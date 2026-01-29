// src/lib/audit.ts
import { db } from "@/lib/db/client";
import { auditEvents } from "@/lib/db/pccSchema";

export async function auditLog(opts: {
  actorClerkUserId: string;
  action: string;
  tenantId?: string | null;
  meta?: Record<string, any>;
}) {
  await db.insert(auditEvents).values({
    actorClerkUserId: opts.actorClerkUserId,
    action: opts.action,
    tenantId: (opts.tenantId ?? null) as any,
    meta: opts.meta ?? {},
  });
}