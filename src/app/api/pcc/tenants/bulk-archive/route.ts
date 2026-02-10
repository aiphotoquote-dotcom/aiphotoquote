// src/app/api/pcc/tenants/bulk-archive/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  tenantIds: z.array(z.string().uuid()).min(1).max(200),
  reason: z.string().max(500).optional(),
});

function rows(r: any): any[] {
  return (r as any)?.rows ?? (Array.isArray(r) ? r : []);
}

async function getTenantMeta(tenantId: string) {
  const r = await db.execute(
    sql`SELECT
          id::text   AS id,
          slug::text AS slug,
          name::text AS name,
          status::text AS status,
          archived_at AS "archivedAt",
          archived_by::text AS "archivedBy",
          archived_reason::text AS "archivedReason"
        FROM tenants
        WHERE id = ${tenantId}::uuid
        LIMIT 1`
  );

  const row = rows(r)?.[0] ?? null;
  if (!row?.id) return null;

  return {
    id: String(row.id),
    slug: row.slug ? String(row.slug) : null,
    name: row.name ? String(row.name) : null,
    status: row.status ? String(row.status) : "active",
    archivedAt: row.archivedAt ?? null,
    archivedBy: row.archivedBy ? String(row.archivedBy) : null,
    archivedReason: row.archivedReason ? String(row.archivedReason) : null,
  };
}

async function getActor(req: NextRequest) {
  // Best-effort; never break the route if Clerk info isn't available.
  try {
    const a = auth();
    const userId = (a as any)?.userId ? String((a as any).userId) : null;

    let email: string | null = null;
    try {
      const u = await currentUser();
      email = (u?.emailAddresses?.[0]?.emailAddress as string) ?? null;
    } catch {
      // ignore
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null;

    return { userId, email, ip };
  } catch {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null;

    return { userId: null, email: null, ip };
  }
}

export async function POST(req: NextRequest) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const bodyJson = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY", issues: parsed.error.issues }, { status: 400 });
  }

  const reason = String(parsed.data.reason ?? "").trim();
  const tenantIds = Array.from(new Set(parsed.data.tenantIds.map((x) => String(x).trim()))).slice(0, 200);

  const actor = await getActor(req);

  const results: Array<{ tenantId: string; archived: boolean; status: string; message?: string }> = [];

  await db.transaction(async (tx: any) => {
    for (const tenantId of tenantIds) {
      const tenant = await getTenantMeta(tenantId);

      if (!tenant) {
        results.push({ tenantId, archived: false, status: "missing", message: "TENANT_NOT_FOUND" });
        continue;
      }

      if (String(tenant.status).toLowerCase() === "archived") {
        results.push({ tenantId, archived: true, status: "archived", message: "ALREADY_ARCHIVED" });
        continue;
      }

      // Archive the tenant (no deletion)
      await tx.execute(sql`
        UPDATE tenants
        SET
          status = 'archived',
          archived_at = now(),
          archived_by = ${actor.userId},
          archived_reason = ${reason || null},
          updated_at = now()
        WHERE id = ${tenantId}::uuid
      `);

      // Audit event (append-only)
      await tx.execute(sql`
        INSERT INTO tenant_audit_log (
          tenant_id,
          action,
          actor_clerk_user_id,
          actor_email,
          actor_ip,
          reason,
          meta
        ) VALUES (
          ${tenantId}::uuid,
          'tenant.archived',
          ${actor.userId},
          ${actor.email},
          ${actor.ip},
          ${reason || null},
          ${JSON.stringify({
            tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
            previousStatus: tenant.status ?? "active",
            bulk: true,
            bulkCount: tenantIds.length,
          })}::jsonb
        )
      `);

      results.push({ tenantId, archived: true, status: "archived" });
    }
  });

  const archivedCount = results.filter((r) => r.archived && r.status === "archived" && r.message !== "ALREADY_ARCHIVED").length;
  const alreadyCount = results.filter((r) => r.message === "ALREADY_ARCHIVED").length;
  const missingCount = results.filter((r) => r.status === "missing").length;

  return NextResponse.json({
    ok: true,
    archivedCount,
    alreadyArchivedCount: alreadyCount,
    missingCount,
    results,
  });
}