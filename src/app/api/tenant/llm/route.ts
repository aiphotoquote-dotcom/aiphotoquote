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
 * RBAC: find role from tenant_members
 * IMPORTANT: enforce status='active' since your table has status and you showed active rows.
 */
async function getTenantRole(userId: string, tenantId: string): Promise<TenantRole | null> {
  const rows = await db.execute(sql`
    SELECT role, status
    FROM tenant_members
    WHERE tenant_id = ${tenantId}::uuid
      AND clerk_user_id = ${userId}
      AND status = 'active'
    LIMIT 1
  `);

  const r: any = (rows as any)?.rows?.[0] ?? null;
  const role = String(r?.role ?? "").trim();

  if (role === "owner" || role === "admin" || role === "member") return role;
  return null;
}

/* -----------------------------
   Schemas
------------------------------ */

const GetQuery = z.object({
  tenantId: z.string().uuid().optional(),
  industryKey: z.string().optional(), // allowed for clients; ignored server-side here
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
  industryKey: z.string().nullable().optional(), // allowed; ignored here
  overrides: OverridesSchema.optional(),
});

/* -----------------------------
   GET
------------------------------ */

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return deny(401, "UNAUTHENTICATED");

  // Parse query (tenantId can be passed explicitly by client)
  const url = new URL(req.url);
  const parsed = GetQuery.safeParse({
    tenantId: url.searchParams.get("tenantId") || undefined,
    industryKey: url.searchParams.get("industryKey") || undefined,
  });
  if (!parsed.success) return deny(400, "BAD_REQUEST", "Invalid query parameters.");

  const tenantId = await resolveTenantId(parsed.data.tenantId ?? null);
  if (!tenantId) return deny(400, "NO_ACTIVE_TENANT", "Select a tenant first.");

  const role = await getTenantRole(userId, tenantId);
  if (!role) {
    // include lightweight debug info so you can see what tenantId the API thinks it’s using
    return deny(403, "FORBIDDEN", "No active tenant membership found for this user.", { tenantId });
  }

  const platformCfg = await loadPlatformLlmConfig();
  const overrides = (await loadTenantLlmOverrides(tenantId)) ?? null;

  // Effective = platform + tenant overrides (guardrails remain platform-only)
  const effective = await getPlatformLlm(); // platform normalized

  const effModels = {
    estimatorModel: overrides?.models?.estimatorModel?.trim() || effective.models.estimatorModel,
    qaModel: overrides?.models?.qaModel?.trim() || effective.models.qaModel,
    renderModel: effective.models.renderModel, // platform-only
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
    platform: platformCfg,
    overrides,
    effective: {
      models: effModels,
      prompts: effPrompts,
      guardrails: effective.guardrails, // read-only for tenant UI
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

  // Accept either:
  // - { tenantId, overrides, industryKey }
  // - or legacy: { ...overridesFields } (no wrapper)
  const parsed = PostBody.safeParse(body);

  let explicitTenantId: string | null = null;
  let overridesInput: unknown = body;

  if (parsed.success) {
    explicitTenantId = parsed.data.tenantId ?? null;
    overridesInput = parsed.data.overrides ?? (body as any)?.overrides ?? body;
  } else {
    // legacy fallback: try tenantId on root
    explicitTenantId = typeof (body as any)?.tenantId === "string" ? (body as any).tenantId : null;
    overridesInput = (body as any)?.overrides ?? body;
  }

  const tenantId = await resolveTenantId(explicitTenantId);
  if (!tenantId) return deny(400, "NO_ACTIVE_TENANT", "Select a tenant first.");

  const role = await getTenantRole(userId, tenantId);
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