// src/app/api/pcc/onboarding-invites/[inviteId]/revoke/route.ts
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { platformOnboardingInvites } from "@/lib/db/schema";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  inviteId: z.string().uuid(),
});

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

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ inviteId: string }> }
) {
  await requirePlatformRole(["platform_owner", "platform_admin"]);

  const rawParams = await context.params;
  const parsed = ParamsSchema.safeParse(rawParams);

  if (!parsed.success) {
    return json(
      {
        ok: false,
        error: "INVALID_PARAMS",
        issues: parsed.error.issues,
      },
      400
    );
  }

  const { inviteId } = parsed.data;

  const existing = await db
    .select({
      id: platformOnboardingInvites.id,
      status: platformOnboardingInvites.status,
      code: platformOnboardingInvites.code,
      email: platformOnboardingInvites.email,
      createdBy: platformOnboardingInvites.createdBy,
      usedByTenantId: platformOnboardingInvites.usedByTenantId,
      usedAt: platformOnboardingInvites.usedAt,
      expiresAt: platformOnboardingInvites.expiresAt,
      meta: platformOnboardingInvites.meta,
      createdAt: platformOnboardingInvites.createdAt,
      updatedAt: platformOnboardingInvites.updatedAt,
    })
    .from(platformOnboardingInvites)
    .where(eq(platformOnboardingInvites.id, inviteId))
    .limit(1);

  const row = existing[0];
  if (!row) {
    return json(
      {
        ok: false,
        error: "INVITE_NOT_FOUND",
      },
      404
    );
  }

  if (String(row.status) === "used") {
    return json(
      {
        ok: false,
        error: "INVITE_ALREADY_USED",
        message: "Used invites cannot be revoked.",
      },
      400
    );
  }

  if (String(row.status) === "revoked") {
    return json({
      ok: true,
      invite: {
        id: String(row.id),
        code: String(row.code),
        email: row.email ? String(row.email) : null,
        createdBy: String(row.createdBy),
        status: "revoked",
        usedByTenantId: row.usedByTenantId ? String(row.usedByTenantId) : null,
        usedAt: row.usedAt ?? null,
        expiresAt: row.expiresAt ?? null,
        meta: row.meta ?? {},
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    });
  }

  const updated = await db
    .update(platformOnboardingInvites)
    .set({
      status: "revoked",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(platformOnboardingInvites.id, inviteId),
        eq(platformOnboardingInvites.status, "pending")
      )
    )
    .returning({
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
    });

  const invite = updated[0];
  if (!invite) {
    return json(
      {
        ok: false,
        error: "REVOKE_FAILED",
      },
      500
    );
  }

  return json({
    ok: true,
    invite: {
      id: String(invite.id),
      code: String(invite.code),
      email: invite.email ? String(invite.email) : null,
      createdBy: String(invite.createdBy),
      status: String(invite.status),
      usedByTenantId: invite.usedByTenantId ? String(invite.usedByTenantId) : null,
      usedAt: invite.usedAt ?? null,
      expiresAt: invite.expiresAt ?? null,
      meta: invite.meta ?? {},
      createdAt: invite.createdAt,
      updatedAt: invite.updatedAt,
    },
  });
}