// src/lib/admin/quotes/getQuote.ts
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs, tenantMembers } from "@/lib/db/schema";

export type AdminQuoteRow = {
  id: string;
  tenantId: string;
  createdAt: any;
  input: any;
  output: any;
  stage: any;
  isRead: any;

  renderOptIn: any;
  renderStatus: any;
  renderImageUrl: any;
  renderError: any;
  renderPrompt: any;
  renderedAt: any;

  currentVersion: any; // may be null
};

export async function getAdminQuoteRow(args: { id: string; tenantId: string }): Promise<AdminQuoteRow | null> {
  const { id, tenantId } = args;

  const row = await db
    .select({
      id: quoteLogs.id,
      tenantId: quoteLogs.tenantId,
      createdAt: quoteLogs.createdAt,
      input: quoteLogs.input,
      output: quoteLogs.output,
      stage: quoteLogs.stage,
      isRead: quoteLogs.isRead,

      renderOptIn: quoteLogs.renderOptIn,
      renderStatus: quoteLogs.renderStatus,
      renderImageUrl: quoteLogs.renderImageUrl,
      renderError: quoteLogs.renderError,
      renderPrompt: quoteLogs.renderPrompt,
      renderedAt: quoteLogs.renderedAt,

      currentVersion: quoteLogs.currentVersion,
    })
    .from(quoteLogs)
    .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantId)))
    .limit(1)
    .then((r) => r[0] ?? null);

  return row ?? null;
}

/**
 * If quote isn't in active tenant, check if it's in ANY tenant user is member of.
 * If yes, return redirectTenantId so caller can redirect via /api/admin/tenant/activate.
 */
export async function findRedirectTenantForQuote(args: { id: string; userId: string }) {
  const { id, userId } = args;

  const q = await db
    .select({ tenantId: quoteLogs.tenantId })
    .from(quoteLogs)
    .where(eq(quoteLogs.id, id))
    .limit(1)
    .then((r) => r[0] ?? null);

  const quoteTenantId = q?.tenantId ? String(q.tenantId) : null;
  if (!quoteTenantId) return null;

  const membership = await db
    .select({ ok: sql<number>`1` })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenantId, quoteTenantId),
        eq(tenantMembers.clerkUserId, userId),
        eq(tenantMembers.status, "active")
      )
    )
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!membership?.ok) return null;
  return quoteTenantId;
}