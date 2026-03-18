// src/app/api/pcc/onboarding-invites/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { platformOnboardingInvites } from "@/lib/db/schema";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateInviteSchema = z.object({
  email: z.string().trim().email().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
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

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function normalizeEmail(v: unknown): string | null {
  const s = safeTrim(v).toLowerCase();
  return s || null;
}

function normalizeDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
}

function randomChars(len: number) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  for (let i = 0; i < len; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function buildInviteCode() {
  return `APQ-${randomChars(4)}-${randomChars(4)}`;
}

async function generateUniqueInviteCode(): Promise<string> {
  for (let i = 0; i < 15; i += 1) {
    const code = buildInviteCode();

    const existing = await db
      .select({ id: platformOnboardingInvites.id })
      .from(platformOnboardingInvites)
      .where(eq(platformOnboardingInvites.code, code))
      .limit(1);

    if (!existing[0]?.id) return code;
  }

  throw new Error("FAILED_TO_GENERATE_UNIQUE_INVITE_CODE");
}

export async function GET() {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

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

  return json({
    ok: true,
    invites: rows.map((row) => ({
      id: String(row.id),
      code: String(row.code),
      email: row.email ? String(row.email) : null,
      createdBy: String(row.createdBy),
      status: String(row.status),
      usedByTenantId: row.usedByTenantId ? String(row.usedByTenantId) : null,
      usedAt: row.usedAt ?? null,
      expiresAt: row.expiresAt ?? null,
      meta: row.meta ?? {},
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const actor = await requirePlatformRole(["platform_owner", "platform_admin"]);

  const bodyJson = await req.json().catch(() => null);
  const parsed = CreateInviteSchema.safeParse(bodyJson);

  if (!parsed.success) {
    return json(
      {
        ok: false,
        error: "INVALID_BODY",
        issues: parsed.error.issues,
      },
      400
    );
  }

  const email = normalizeEmail(parsed.data.email);
  const expiresAt = normalizeDate(parsed.data.expiresAt);
  const note = safeTrim(parsed.data.note);

  if (parsed.data.expiresAt && !expiresAt) {
    return json(
      {
        ok: false,
        error: "INVALID_EXPIRES_AT",
      },
      400
    );
  }

  const code = await generateUniqueInviteCode();

  const inserted = await db
    .insert(platformOnboardingInvites)
    .values({
      code,
      email,
      createdBy: actor.clerkUserId,
      status: "pending",
      expiresAt,
      meta: {
        note: note || null,
        actorEmail: actor.email ?? null,
        platformRole: actor.platformRole,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    })
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

  const invite = inserted[0];
  if (!invite) {
    return json(
      {
        ok: false,
        error: "CREATE_FAILED",
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
      inviteLink: `/sign-up?invite=${encodeURIComponent(String(invite.code))}`,
    },
  });
}