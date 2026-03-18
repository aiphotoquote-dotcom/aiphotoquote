// src/app/api/pcc/impersonate/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { getActorContext } from "@/lib/rbac/actor";
import { hasPlatformRole } from "@/lib/rbac/guards";
import {
  readTenantImpersonationFromCookies,
  clearTenantImpersonationCookie,
} from "@/lib/platform/tenantImpersonation";
import {
  setActiveTenantCookie,
  clearActiveTenantCookies,
} from "@/lib/tenant/activeTenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      pragma: "no-cache",
      expires: "0",
    },
  });
}

function firstRow(r: any): any | null {
  try {
    if (!r) return null;
    if (Array.isArray(r)) return r[0] ?? null;
    if (typeof r === "object" && r !== null && Array.isArray((r as any).rows)) return (r as any).rows[0] ?? null;
    if (typeof r === "object" && r !== null && 0 in r) return (r as any)[0] ?? null;
    return null;
  } catch {
    return null;
  }
}

async function getPlatformActorOr403() {
  try {
    const actor = await getActorContext();
    if (!hasPlatformRole(actor, ["platform_owner", "platform_admin", "platform_support"])) {
      return { ok: false as const, res: json({ ok: false, error: "FORBIDDEN" }, 403) };
    }
    return { ok: true as const, actor };
  } catch (e: any) {
    return {
      ok: false as const,
      res: json({ ok: false, error: "UNAUTHENTICATED", message: e?.message ?? String(e) }, 401),
    };
  }
}

async function loadTenant(tenantId: string) {
  const r = await db.execute(sql`
    select
      t.id,
      t.name,
      t.slug
    from tenants t
    where t.id = ${tenantId}::uuid
    limit 1
  `);

  const row = firstRow(r);
  if (!row?.id) return null;

  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    slug: String(row.slug ?? ""),
  };
}

async function appendAuditLog(args: {
  tenantId: string;
  action: string;
  actorClerkUserId: string;
  actorEmail: string | null;
  meta?: any;
}) {
  try {
    await db.execute(sql`
      insert into tenant_audit_log (
        tenant_id,
        action,
        actor_clerk_user_id,
        actor_email,
        meta
      )
      values (
        ${args.tenantId}::uuid,
        ${args.action},
        ${args.actorClerkUserId},
        ${args.actorEmail ?? null},
        ${args.meta ?? {}}::jsonb
      )
    `);
  } catch (e) {
    console.error("[impersonate.stop] audit log write failed", e);
  }
}

export async function GET() {
  const guard = await getPlatformActorOr403();
  if (!guard.ok) return guard.res;

  const imp = await readTenantImpersonationFromCookies();
  if (!imp) {
    return json({ ok: true, active: false, impersonation: null });
  }

  if (imp.actorClerkUserId !== guard.actor.clerkUserId) {
    return json({ ok: true, active: false, impersonation: null });
  }

  const tenant = await loadTenant(imp.tenantId);
  if (!tenant) {
    return json({ ok: true, active: false, impersonation: null });
  }

  return json({
    ok: true,
    active: true,
    impersonation: {
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      previousTenantId: imp.previousTenantId,
      actorClerkUserId: imp.actorClerkUserId,
      actorEmail: imp.actorEmail,
      startedAt: imp.startedAt,
    },
  });
}

export async function DELETE() {
  const guard = await getPlatformActorOr403();
  if (!guard.ok) return guard.res;

  const imp = await readTenantImpersonationFromCookies();
  const res = json({
    ok: true,
    active: false,
    redirectTo: imp?.tenantId ? `/pcc/tenants/${encodeURIComponent(imp.tenantId)}` : "/pcc/tenants",
  });

  if (!imp || imp.actorClerkUserId !== guard.actor.clerkUserId) {
    clearTenantImpersonationCookie(res);
    return res;
  }

  await appendAuditLog({
    tenantId: imp.tenantId,
    action: "tenant.impersonation_stopped",
    actorClerkUserId: guard.actor.clerkUserId,
    actorEmail: guard.actor.email ?? null,
    meta: {
      tenantId: imp.tenantId,
      previousTenantId: imp.previousTenantId,
      startedAt: imp.startedAt,
      stoppedAt: new Date().toISOString(),
      platformRole: guard.actor.platformRole,
    },
  });

  clearTenantImpersonationCookie(res);

  if (imp.previousTenantId) {
    setActiveTenantCookie(res, imp.previousTenantId);
  } else {
    clearActiveTenantCookies(res);
  }

  return res;
}