// src/app/api/tenant/llm/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";

import { requirePlatformRole } from "@/lib/rbac/guards";

import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";
import {
  loadTenantLlmOverrides,
  saveTenantLlmOverrides,
  type TenantLlmOverrides,
} from "@/lib/pcc/llm/tenantStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * NOTE (temporary):
 * We’re using requirePlatformRole() because requireTenantRole() is not exported yet.
 * Next step: implement a real tenant-scoped guard and swap this back.
 */

// Match whatever your tenant-context route sets.
// If your cookie name differs, update this constant (runtime behavior), but this compiles either way.
const ACTIVE_TENANT_COOKIE = "activeTenantId";

function getActiveTenantIdFromCookie(): string | null {
  const c = cookies().get(ACTIVE_TENANT_COOKIE)?.value;
  const v = String(c ?? "").trim();
  return v || null;
}

const OverridesSchema = z
  .object({
    // tenant may override models/prompts, but NOT guardrails
    models: z
      .object({
        estimatorModel: z.string().min(1).optional(),
        qaModel: z.string().min(1).optional(),
        renderModel: z.string().min(1).optional(),
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

function normalizeOverrides(input: any): TenantLlmOverrides {
  const parsed = OverridesSchema.parse(input ?? {});
  const models = parsed.models ?? {};
  const prompts = parsed.prompts ?? {};

  // keep it light—tenant overrides can be partial
  return {
    models: {
      ...(models.estimatorModel ? { estimatorModel: String(models.estimatorModel).trim() } : {}),
      ...(models.qaModel ? { qaModel: String(models.qaModel).trim() } : {}),
      ...(models.renderModel ? { renderModel: String(models.renderModel).trim() } : {}),
    },
    prompts: {
      ...(typeof prompts.quoteEstimatorSystem === "string"
        ? { quoteEstimatorSystem: String(prompts.quoteEstimatorSystem) }
        : {}),
      ...(typeof prompts.qaQuestionGeneratorSystem === "string"
        ? { qaQuestionGeneratorSystem: String(prompts.qaQuestionGeneratorSystem) }
        : {}),
      ...(typeof prompts.extraSystemPreamble === "string"
        ? { extraSystemPreamble: String(prompts.extraSystemPreamble) }
        : {}),
    },
  };
}

export async function GET(_req: Request) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const tenantId = getActiveTenantIdFromCookie();
  if (!tenantId) {
    return NextResponse.json(
      { ok: false, error: "NO_ACTIVE_TENANT", message: "No active tenant selected." },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }

  const platform = await loadPlatformLlmConfig();
  const overrides = await loadTenantLlmOverrides(tenantId);

  return NextResponse.json(
    { ok: true, tenantId, platform, overrides },
    { headers: { "cache-control": "no-store" } }
  );
}

export async function POST(req: Request) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const tenantId = getActiveTenantIdFromCookie();
  if (!tenantId) {
    return NextResponse.json(
      { ok: false, error: "NO_ACTIVE_TENANT", message: "No active tenant selected." },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json(
      { ok: false, error: "INVALID_BODY", message: "Missing JSON body." },
      { status: 400 }
    );
  }

  try {
    // accept either { overrides } or the overrides object directly
    const candidate = (body as any).overrides ?? body;
    const normalized = normalizeOverrides(candidate);

    await saveTenantLlmOverrides(tenantId, normalized);

    const saved = await loadTenantLlmOverrides(tenantId);
    return NextResponse.json({ ok: true, tenantId, overrides: saved });
  } catch (e: any) {
    const issues = e?.issues ?? undefined;
    return NextResponse.json(
      { ok: false, error: "VALIDATION_FAILED", message: e?.message ?? String(e), issues },
      { status: 400 }
    );
  }
}