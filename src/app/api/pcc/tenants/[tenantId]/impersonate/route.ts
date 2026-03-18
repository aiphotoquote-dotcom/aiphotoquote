// src/app/api/pcc/tenants/[tenantId]/impersonate/route.ts

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";
import { getActorContext } from "@/lib/rbac/actor";
import { readActiveTenantIdFromCookies, setActiveTenantCookie } from "@/lib/tenant/activeTenant";
import {
  setTenantImpersonationCookie,
  type TenantImpersonationPayload,
} from "@/lib/platform/tenantImpersonation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  tenantId: z.string().uuid(),
});

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

async function loadTenantForImpersonation(tenantId: string) {
  const r = await db.execute(sql`
    select
      t.id,
      t.name,
      t.slug,
      coalesce(t.status, 'active') as status
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
    status: String(row.status ?? "active"),
  };
}

async function appendAuditLog(args: {
  tenantId: string;
  action: string;
  actorClerkUserId: string;
  actorEmail: string | null;
  reason?: string | null;
  meta?: any;
}) {
  try {
    await db.execute(sql`
      insert into tenant_audit_log (
        tenant_id,
        action,
        actor_clerk_user_id,
        actor_email,
        reason,
        meta
      )
      values (
        ${args.tenantId}::uuid,
        ${args.action},
        ${args.actorClerkUserId},
        ${args.actorEmail ?? null},
        ${args.reason ?? null},
        ${args.meta ?? {}}::jsonb
      )
    `);
  } catch (e) {
    console.error("[impersonate] audit log write failed", e);
  }
}

export async function POST(_req: NextRequest, context: { params: Promise<{ tenantId: string }> }) {
  try {
    await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

    const actor = await getActorContext();

    const p = await context.params;
    const parsed = ParamsSchema.safeParse(p);
    if (!parsed.success) {
      return json({ ok: false, error: "INVALID_PARAMS", issues: parsed.error.issues }, 400);
    }

    const { tenantId } = parsed.data;
    const tenant = await loadTenantForImpersonation(tenantId);

    if (!tenant) {
      return json({ ok: false, error: "TENANT_NOT_FOUND" }, 404);
    }

    if (String(tenant.status).toLowerCase() === "archived") {
      return json(
        {
          ok: false,
          error: "TENANT_ARCHIVED",
          message: "Archived tenants cannot be impersonated.",
        },
        400
      );
    }

    const previousTenantId = await readActiveTenantIdFromCookies();

    const payload: TenantImpersonationPayload = {
      tenantId: tenant.id,
      previousTenantId: previousTenantId ?? null,
      actorClerkUserId: actor.clerkUserId,
      actorEmail: actor.email ?? null,
      startedAt: new Date().toISOString(),
    };

    await appendAuditLog({
      tenantId: tenant.id,
      action: "tenant.impersonation_started",
      actorClerkUserId: actor.clerkUserId,
      actorEmail: actor.email ?? null,
      meta: {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        tenantName: tenant.name,
        previousTenantId: previousTenantId ?? null,
        platformRole: actor.platformRole,
      },
    });

    const res = json({
      ok: true,
      redirectTo: "/admin",
      impersonation: {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        tenantName: tenant.name,
        startedAt: payload.startedAt,
      },
    });

    setTenantImpersonationCookie(res, payload);
    setActiveTenantCookie(res, tenant.id);

    return res;
  } catch (e: any) {
    return json(
      {
        ok: false,
        error: "IMPERSONATION_START_FAILED",
        message: e?.message ?? String(e),
      },
      500
    );
  }
}