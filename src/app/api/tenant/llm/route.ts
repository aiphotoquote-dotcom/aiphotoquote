// src/app/api/tenant/llm/route.ts

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
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

/**
 * Resolve tenantId:
 * - Prefer explicit tenantId (query/body)
 * - Fallback to cookie via shared reader (supports multiple cookie keys)
 */
async function resolveTenantId(explicitTenantId?: string | null): Promise<string | null> {
  const t = String(explicitTenantId ?? "").trim();
  if (t) return t;
  return await readActiveTenantIdFromCookies();
}

/**
 * RBAC role resolution:
 * 1) Prefer tenant_members (status='active')
 * 2) Migration fallback: if no membership exists yet, allow owners via tenants.owner_clerk_user_id
 *
 * This prevents "site breaks" during rollout while we backfill tenant_members.
 */
async function resolveRole(userId: string, tenantId: string): Promise<{ role: TenantRole | null; source: "member" | "owner_fallback" | "none" }> {
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
  if (memRole === "owner" || memRole === "admin" || memRole === "member") {
    return { role: memRole, source: "member" };
  }

  // 2) Migration fallback: owner in tenants table
  const tRows = await db.execute(sql`
    SELECT owner_clerk_user_id
    FROM tenants
    WHERE id = ${tenantId}::uuid
    LIMIT 1
  `);

  const t: any = (tRows as any)?.rows?.[0] ?? null;
  const ownerId = String(t?.owner_clerk_user_id ?? "").trim();
  if (ownerId && ownerId === userId) {
    return { role: "owner", source: "owner_fallback" };
  }

  return { role: null, source: "none" };
}

/* -----------------------------
   Schemas
------------------------------ */

const GetQuery = z.object({
  tenantId: z.string().uuid().optional(),
  industryKey: z.string().optional(), // allowed; ignored here
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

  const { role, source } = await resolveRole(userId, tenantId);
  if (!role) return deny(403, "FORBIDDEN", "No tenant access found for this user.", { tenantId });

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
    role,
    roleSource: source, // "member" or "owner_fallback"
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

  const { role } = await resolveRole(userId, tenantId);
  if (!isAdminRole(role)) {
    return deny(403, "FORBIDDEN", "Only owner/admin can edit LLM settings.", { tenantId });
  }

  try {
    const parsedOverrides = OverridesSchema.parse(overridesInput);
    const normalized = normalizeTenantOverrides(parsedOverrides) as TenantLlmOverrides;

    const saved = await saveTenantLlmOverrides(tenantId, normalized);

    return NextResponse.json({ ok: true, tenantId, role, overrides: saved });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_FAILED", message: e?.message ?? String(e), issues: e?.issues },
      { status: 400 }
    );
  }
}