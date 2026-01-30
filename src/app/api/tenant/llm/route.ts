// src/app/api/tenant/llm/route.ts

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { sql, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { readActiveTenantIdFromCookies } from "@/lib/tenant/activeTenant";

import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";
import { getPlatformLlm } from "@/lib/pcc/llm/apply";
import { loadTenantLlmOverrides, saveTenantLlmOverrides } from "@/lib/pcc/llm/tenantStore";
import { normalizeTenantOverrides, type TenantLlmOverrides } from "@/lib/pcc/llm/tenantTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TenantRole = "owner" | "admin" | "member";

function isAdminRole(role: TenantRole | null | undefined) {
  return role === "owner" || role === "admin";
}

function deny(status: number, error: string, message?: string, extra?: Record<string, any>) {
  return NextResponse.json(
    { ok: false, error, ...(message ? { message } : {}), ...(extra ? extra : {}) },
    { status }
  );
}

async function resolveTenantId(explicitTenantId?: string | null): Promise<string | null> {
  const t = String(explicitTenantId ?? "").trim();
  if (t) return t;
  return await readActiveTenantIdFromCookies();
}

/**
 * RBAC role resolution:
 * 1) Prefer tenant_members (status='active')
 * 2) Migration fallback: allow owners via tenants.ownerClerkUserId
 *
 * Returns role + debug so we can see exactly why it denied.
 */
async function resolveRoleWithDebug(userId: string, tenantId: string): Promise<{
  role: TenantRole | null;
  debug: {
    userId: string;
    tenantId: string;
    membershipFound: boolean;
    membershipRole: string | null;
    tenantRowFound: boolean;
    ownerClerkUserId: string | null;
  };
}> {
  // 1) Try tenant_members first
  const memRows = await db.execute(sql`
    SELECT role, status
    FROM tenant_members
    WHERE tenant_id = ${tenantId}::uuid
      AND clerk_user_id = ${userId}
      AND status = 'active'
    LIMIT 1
  `);

  const mem: any = (memRows as any)?.rows?.[0] ?? null;
  const memRole = String(mem?.role ?? "").trim();
  const membershipFound = !!memRole;

  if (memRole === "owner" || memRole === "admin" || memRole === "member") {
    return {
      role: memRole,
      debug: {
        userId,
        tenantId,
        membershipFound: true,
        membershipRole: memRole,
        tenantRowFound: true, // doesn't matter if membership exists
        ownerClerkUserId: null,
      },
    };
  }

  // 2) Owner fallback via Drizzle schema (safer than raw SQL column guessing)
  const tenantRow = await db
    .select({ ownerClerkUserId: tenants.ownerClerkUserId })
    .from(tenants)
    .where(eq(tenants.id, tenantId as any))
    .limit(1)
    .then((r) => r[0] ?? null);

  const ownerId = String(tenantRow?.ownerClerkUserId ?? "").trim() || null;

  if (ownerId && ownerId === userId) {
    return {
      role: "owner",
      debug: {
        userId,
        tenantId,
        membershipFound,
        membershipRole: memRole || null,
        tenantRowFound: true,
        ownerClerkUserId: ownerId,
      },
    };
  }

  return {
    role: null,
    debug: {
      userId,
      tenantId,
      membershipFound,
      membershipRole: memRole || null,
      tenantRowFound: !!tenantRow,
      ownerClerkUserId: ownerId,
    },
  };
}

/* -----------------------------
   Schemas
------------------------------ */

const GetQuery = z.object({
  tenantId: z.string().uuid().optional(),
  industryKey: z.string().optional(),
});

const OverridesSchema = z
  .object({
    models: z
      .object({
        estimatorModel: z.string().optional(),
        qaModel: z.string().optional(),
      })
      .partial()
      .optional(),
    prompts: z
      .object({
        quoteEstimatorSystem: z.string().optional(),
        qaQuestionGeneratorSystem: z.string().optional(),
        extraSystemPreamble: z.string().optional(),
      })
      .partial()
      .optional(),
  })
  .partial();

const PostBody = z.object({
  tenantId: z.string().uuid().optional(),
  industryKey: z.string().nullable().optional(),
  overrides: OverridesSchema.optional(),
});

/* -----------------------------
   GET
------------------------------ */

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return deny(401, "UNAUTHENTICATED");

  const url = new URL(req.url);
  const parsed = GetQuery.safeParse({
    tenantId: url.searchParams.get("tenantId") || undefined,
    industryKey: url.searchParams.get("industryKey") || undefined,
  });
  if (!parsed.success) return deny(400, "BAD_REQUEST", "Invalid query parameters.");

  const tenantId = await resolveTenantId(parsed.data.tenantId ?? null);
  if (!tenantId) return deny(400, "NO_ACTIVE_TENANT", "Select a tenant first.");

  const gate = await resolveRoleWithDebug(userId, tenantId);
  if (!gate.role) {
    return deny(403, "FORBIDDEN", "No tenant access found for this user.", {
      tenantId,
      debug: gate.debug,
    });
  }

  const platformCfg = await loadPlatformLlmConfig();
  const overrides = (await loadTenantLlmOverrides(tenantId)) ?? null;

  const effective = await getPlatformLlm();

  const effModels = {
    estimatorModel: overrides?.models?.estimatorModel?.trim() || effective.models.estimatorModel,
    qaModel: overrides?.models?.qaModel?.trim() || effective.models.qaModel,
    renderModel: effective.models.renderModel,
  };

  const effPrompts = {
    quoteEstimatorSystem:
      (overrides?.prompts?.quoteEstimatorSystem ?? "").trim() || effective.prompts.quoteEstimatorSystem,
    qaQuestionGeneratorSystem:
      (overrides?.prompts?.qaQuestionGeneratorSystem ?? "").trim() ||
      effective.prompts.qaQuestionGeneratorSystem,
    extraSystemPreamble:
      (overrides?.prompts?.extraSystemPreamble ?? "").trim() ||
      (platformCfg.prompts?.extraSystemPreamble ?? ""),
  };

  return NextResponse.json({
    ok: true,
    tenantId,
    role: gate.role,
    platform: platformCfg,
    overrides,
    effective: {
      models: effModels,
      prompts: effPrompts,
      guardrails: effective.guardrails,
    },
  });
}

/* -----------------------------
   POST
------------------------------ */

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return deny(401, "UNAUTHENTICATED");

  const body = await req.json().catch(() => null);
  if (!body) return deny(400, "INVALID_BODY", "Missing JSON body.");

  const parsed = PostBody.safeParse(body);

  let explicitTenantId: string | null = null;
  let overridesInput: unknown = body;

  if (parsed.success) {
    explicitTenantId = parsed.data.tenantId ?? null;
    overridesInput = parsed.data.overrides ?? (body as any)?.overrides ?? body;
  } else {
    explicitTenantId = typeof (body as any)?.tenantId === "string" ? (body as any).tenantId : null;
    overridesInput = (body as any)?.overrides ?? body;
  }

  const tenantId = await resolveTenantId(explicitTenantId);
  if (!tenantId) return deny(400, "NO_ACTIVE_TENANT", "Select a tenant first.");

  const gate = await resolveRoleWithDebug(userId, tenantId);
  if (!isAdminRole(gate.role)) {
    return deny(403, "FORBIDDEN", "Only owner/admin can edit LLM settings.", {
      tenantId,
      debug: gate.debug,
    });
  }

  try {
    const parsedOverrides = OverridesSchema.parse(overridesInput);
    const normalized = normalizeTenantOverrides(parsedOverrides) as TenantLlmOverrides;

    const saved = await saveTenantLlmOverrides(tenantId, normalized);

    return NextResponse.json({ ok: true, tenantId, role: gate.role, overrides: saved });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_FAILED", message: e?.message ?? String(e), issues: e?.issues },
      { status: 400 }
    );
  }
}