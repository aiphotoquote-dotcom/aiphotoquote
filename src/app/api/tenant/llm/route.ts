// src/app/api/tenant/llm/route.ts

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";

import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";
import { getPlatformLlm } from "@/lib/pcc/llm/apply";
import { loadTenantLlmOverrides, saveTenantLlmOverrides } from "@/lib/pcc/llm/tenantStore";
import { normalizeTenantOverrides, type TenantLlmOverrides } from "@/lib/pcc/llm/tenantTypes";

export const runtime = "nodejs";

const ACTIVE_TENANT_COOKIE = "apq_active_tenant_id"; // must match /api/tenant/context cookie name

function isAdminRole(role: string | null | undefined) {
  return role === "owner" || role === "admin";
}

async function getActiveTenantId(): Promise<string | null> {
  // Next 16 route handlers can have async cookies()
  const jar = await cookies();
  const v = jar.get(ACTIVE_TENANT_COOKIE)?.value;
  const tid = String(v ?? "").trim();
  return tid || null;
}

async function getTenantRole(userId: string, tenantId: string): Promise<"owner" | "admin" | "member" | null> {
  const rows = await db.execute(sql`
    SELECT role
    FROM tenant_members
    WHERE tenant_id = ${tenantId}::uuid
      AND clerk_user_id = ${userId}
    LIMIT 1
  `);

  const r: any = (rows as any)?.rows?.[0] ?? null;
  const role = String(r?.role ?? "").trim();
  if (role === "owner" || role === "admin" || role === "member") return role;
  return null;
}

const OverridesSchema = z.object({
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
}).partial();

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });

  const tenantId = await getActiveTenantId();
  if (!tenantId) {
    return NextResponse.json(
      { ok: false, error: "NO_ACTIVE_TENANT", message: "Select a tenant first." },
      { status: 400 }
    );
  }

  const role = await getTenantRole(userId, tenantId);
  if (!role) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

  const platformCfg = await loadPlatformLlmConfig();
  const overrides = (await loadTenantLlmOverrides(tenantId)) ?? null;

  // Effective = platform + tenant overrides (no tenant guardrails)
  const effective = await getPlatformLlm(); // already normalizes platform config
  const effModels = {
    estimatorModel: overrides?.models?.estimatorModel?.trim() || effective.models.estimatorModel,
    qaModel: overrides?.models?.qaModel?.trim() || effective.models.qaModel,
    renderModel: effective.models.renderModel, // platform-only
  };

  const effPrompts = {
    quoteEstimatorSystem:
      (overrides?.prompts?.quoteEstimatorSystem ?? "").trim() || effective.prompts.quoteEstimatorSystem,
    qaQuestionGeneratorSystem:
      (overrides?.prompts?.qaQuestionGeneratorSystem ?? "").trim() || effective.prompts.qaQuestionGeneratorSystem,
    extraSystemPreamble: (overrides?.prompts?.extraSystemPreamble ?? "").trim() || platformCfg.prompts?.extraSystemPreamble || "",
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

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });

  const tenantId = await getActiveTenantId();
  if (!tenantId) {
    return NextResponse.json(
      { ok: false, error: "NO_ACTIVE_TENANT", message: "Select a tenant first." },
      { status: 400 }
    );
  }

  const role = await getTenantRole(userId, tenantId);
  if (!isAdminRole(role)) {
    return NextResponse.json(
      { ok: false, error: "FORBIDDEN", message: "Only owner/admin can edit LLM settings." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY", message: "Missing JSON body." }, { status: 400 });
  }

  try {
    const parsed = OverridesSchema.parse((body as any)?.overrides ?? body);
    const normalized = normalizeTenantOverrides(parsed) as TenantLlmOverrides;

    // Guardrails are platform-only; ignore if client tries to send them
    const saved = await saveTenantLlmOverrides(tenantId, normalized);

    return NextResponse.json({ ok: true, tenantId, role, overrides: saved });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_FAILED", message: e?.message ?? String(e), issues: e?.issues },
      { status: 400 }
    );
  }
}