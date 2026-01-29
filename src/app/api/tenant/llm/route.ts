// src/app/api/tenant/llm/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRole } from "@/lib/rbac/guards";

import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";
import { loadTenantLlmOverrides, saveTenantLlmOverrides, type TenantLlmOverrides } from "@/lib/pcc/llm/tenantStore";
import { buildEffectiveLlmConfig, getIndustryDefaults } from "@/lib/pcc/llm/effective";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TenantOverridesSchema = z.object({
  version: z.number().int().optional(),
  updatedAt: z.string().nullable().optional(),

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

  maxQaQuestions: z.number().int().min(1).max(10).optional(),
});

function safeStr(v: unknown) {
  const s = String(v ?? "").trim();
  return s;
}

export async function GET(req: Request) {
  // Tenant-side access control (owner/admin only)
  await requireTenantRole(["owner", "admin"]);

  const url = new URL(req.url);
  const tenantId = safeStr(url.searchParams.get("tenantId"));
  const industryKey = safeStr(url.searchParams.get("industryKey")) || null;

  if (!tenantId) {
    return NextResponse.json({ ok: false, error: "MISSING_TENANT_ID", message: "tenantId is required." }, { status: 400 });
  }

  const platform = await loadPlatformLlmConfig();
  const tenant = await loadTenantLlmOverrides(tenantId);
  const industry = getIndustryDefaults(industryKey);

  const bundle = buildEffectiveLlmConfig({ platform, industry, tenant });

  return NextResponse.json(
    {
      ok: true,
      platform: bundle.platform,
      industry: bundle.industry,
      tenant: bundle.tenant,
      effective: bundle.effective,
      permissions: {
        tenantEditable: {
          models: true,
          prompts: true,
          maxQaQuestions: true,
          guardrails: false,
        },
      },
    },
    { headers: { "cache-control": "no-store" } }
  );
}

export async function POST(req: Request) {
  await requireTenantRole(["owner", "admin"]);

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY", message: "Missing JSON body." }, { status: 400 });
  }

  const tenantId = safeStr((body as any).tenantId);
  const candidate = (body as any).overrides ?? (body as any).config ?? body;

  if (!tenantId) {
    return NextResponse.json({ ok: false, error: "MISSING_TENANT_ID", message: "tenantId is required." }, { status: 400 });
  }

  try {
    const parsed = TenantOverridesSchema.parse(candidate);

    // Hard-enforce: tenant cannot set guardrails (ignore if present)
    const overrides: TenantLlmOverrides = {
      version: parsed.version ?? 1,
      updatedAt: parsed.updatedAt ?? null,
      models: parsed.models ?? {},
      prompts: parsed.prompts ?? {},
      maxQaQuestions: parsed.maxQaQuestions,
    };

    await saveTenantLlmOverrides(tenantId, overrides);

    // Return latest computed bundle
    const platform = await loadPlatformLlmConfig();
    const tenant = await loadTenantLlmOverrides(tenantId);

    // industryKey can be passed again if you want effective preview to reflect it
    const industryKey = safeStr((body as any).industryKey) || null;
    const industry = getIndustryDefaults(industryKey);

    const bundle = buildEffectiveLlmConfig({ platform, industry, tenant });

    return NextResponse.json({ ok: true, tenant: bundle.tenant, effective: bundle.effective });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_FAILED", message: e?.message ?? String(e), issues: e?.issues },
      { status: 400 }
    );
  }
}