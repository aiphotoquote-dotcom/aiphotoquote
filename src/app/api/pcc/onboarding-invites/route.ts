// src/app/api/pcc/onboarding-invites/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { platformOnboardingInvites } from "@/lib/db/schema";
import { requirePlatformRole } from "@/lib/rbac/guards";
import { sendInviteEmail } from "@/lib/platform/email/sendInviteEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateInviteSchema = z.object({
  email: z.string().trim().email().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),

  campaignKey: z.string().trim().max(120).nullable().optional(),
  source: z.string().trim().max(120).nullable().optional(),
  targetIndustryKey: z.string().trim().max(120).nullable().optional(),
  targetIndustryLocked: z.boolean().optional(),
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

function normalizeKey(v: unknown): string | null {
  const s = safeTrim(v);
  return s || null;
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

function shapeInvite(row: any) {
  return {
    id: String(row.id),
    code: String(row.code),
    email: row.email ? String(row.email) : null,
    createdBy: String(row.createdBy),
    createdByEmail: row.createdByEmail ? String(row.createdByEmail) : null,
    campaignKey: row.campaignKey ? String(row.campaignKey) : null,
    source: row.source ? String(row.source) : null,
    targetIndustryKey: row.targetIndustryKey ? String(row.targetIndustryKey) : null,
    targetIndustryLocked: Boolean(row.targetIndustryLocked ?? false),
    status: String(row.status),
    usedByTenantId: row.usedByTenantId ? String(row.usedByTenantId) : null,
    usedAt: row.usedAt ?? null,
    expiresAt: row.expiresAt ?? null,
    meta: row.meta ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    inviteLink: `/invite/${encodeURIComponent(String(row.code))}`,
  };
}

function absoluteInviteLink(req: NextRequest, code: string) {
  const envBase =
    safeTrim(process.env.NEXT_PUBLIC_APP_URL) ||
    safeTrim(process.env.APP_URL) ||
    safeTrim(process.env.NEXT_PUBLIC_SITE_URL);

  if (envBase) {
    const base = envBase.replace(/\/+$/, "");
    return `${base}/invite/${encodeURIComponent(code)}`;
  }

  return `${req.nextUrl.origin}/invite/${encodeURIComponent(code)}`;
}

export async function GET() {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const rows = await db
    .select({
      id: platformOnboardingInvites.id,
      code: platformOnboardingInvites.code,
      email: platformOnboardingInvites.email,
      createdBy: platformOnboardingInvites.createdBy,
      createdByEmail: platformOnboardingInvites.createdByEmail,
      campaignKey: platformOnboardingInvites.campaignKey,
      source: platformOnboardingInvites.source,
      targetIndustryKey: platformOnboardingInvites.targetIndustryKey,
      targetIndustryLocked: platformOnboardingInvites.targetIndustryLocked,
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
    invites: rows.map(shapeInvite),
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

  const campaignKey = normalizeKey(parsed.data.campaignKey);
  const source = normalizeKey(parsed.data.source);
  const targetIndustryKey = normalizeKey(parsed.data.targetIndustryKey);
  const targetIndustryLocked = Boolean(parsed.data.targetIndustryLocked ?? false);

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
      createdByEmail: actor.email ?? null,
      campaignKey,
      source,
      targetIndustryKey,
      targetIndustryLocked,
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
      createdByEmail: platformOnboardingInvites.createdByEmail,
      campaignKey: platformOnboardingInvites.campaignKey,
      source: platformOnboardingInvites.source,
      targetIndustryKey: platformOnboardingInvites.targetIndustryKey,
      targetIndustryLocked: platformOnboardingInvites.targetIndustryLocked,
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

  let emailSendOk = true;
  let emailSendError: string | null = null;
  let emailProviderMessageId: string | null = null;

  if (invite.email) {
    const sendRes = await sendInviteEmail({
      email: String(invite.email),
      inviteCode: String(invite.code),
      inviteLink: absoluteInviteLink(req, String(invite.code)),
    });

    emailSendOk = Boolean(sendRes?.ok);
    emailSendError = sendRes?.ok ? null : sendRes?.error ?? "Failed to send invite email";

    if ("providerMessageId" in sendRes) {
      emailProviderMessageId = sendRes.providerMessageId ?? null;
    }
  }

  return json({
    ok: true,
    invite: shapeInvite(invite),
    emailSendOk,
    emailSendError,
    emailProviderMessageId,
  });
}