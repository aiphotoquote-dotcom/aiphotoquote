// src/app/api/tenant/llm/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireTenantRole } from "@/lib/auth/tenant";
import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";
import { normalizeTenantOverrides, type TenantLlmOverrides } from "@/lib/pcc/llm/tenantTypes";
import { getTenantLlmOverrides, upsertTenantLlmOverrides } from "@/lib/pcc/llm/tenantStore";
import { getIndustryDefaults, buildEffectiveLlmConfig } from "@/lib/pcc/llm/effective";

export const runtime = "nodejs";

const GetQuery = z.object({
  tenantId: z.string().uuid(),
  industryKey: z.string().optional(),
});

const PostBody = z.object({
  tenantId: z.string().uuid(),
  industryKey: z.string().nullable().optional(),
  overrides: z.any(),
});

export async function GET(req: Request) {
  try {
    // Gate: tenant admin roles (matches the PCC tenant editing intent)
    await requireTenantRole(["owner", "admin"]);

    const url = new URL(req.url);
    const parsed = GetQuery.safeParse({
      tenantId: url.searchParams.get("tenantId") || "",
      industryKey: url.searchParams.get("industryKey") || undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "BAD_REQUEST", message: "Invalid query params", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { tenantId, industryKey } = parsed.data;

    const platform = await loadPlatformLlmConfig();
    const industry = getIndustryDefaults(industryKey ?? null);

    const tenantRow = await getTenantLlmOverrides(tenantId);
    const tenant: TenantLlmOverrides | null = tenantRow
      ? normalizeTenantOverrides({
          models: tenantRow.models ?? {},
          prompts: tenantRow.prompts ?? {},
          updatedAt: tenantRow.updatedAt ?? undefined,
        })
      : null;

    // Effective WITH tenant overrides
    const effective = buildEffectiveLlmConfig({
      platform,
      industry,
      tenant: tenant ?? null,
    }).effective;

    // Effective BASELINE (platform + industry only) — used for "Inherited — <default>" labels
    const effectiveBase = buildEffectiveLlmConfig({
      platform,
      industry,
      tenant: null,
    }).effective;

    return NextResponse.json({
      ok: true,
      platform,
      industry,
      tenant,
      effective,
      effectiveBase,
      permissions: { canEdit: true },
    });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const code = msg === "NO_ACTIVE_TENANT" ? 401 : 500;
    return NextResponse.json({ ok: false, error: "REQUEST_FAILED", message: msg }, { status: code });
  }
}

export async function POST(req: Request) {
  try {
    await requireTenantRole(["owner", "admin"]);

    const body = await req.json().catch(() => null);
    const parsed = PostBody.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "BAD_REQUEST", message: "Invalid payload", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { tenantId, industryKey, overrides } = parsed.data;

    const normalized = normalizeTenantOverrides(overrides ?? {});

    await upsertTenantLlmOverrides({
      tenantId,
      models: normalized.models ?? {},
      prompts: normalized.prompts ?? {},
    });

    const platform = await loadPlatformLlmConfig();
    const industry = getIndustryDefaults((industryKey ?? null) as any);

    const tenantRow = await getTenantLlmOverrides(tenantId);
    const tenant: TenantLlmOverrides | null = tenantRow
      ? normalizeTenantOverrides({
          models: tenantRow.models ?? {},
          prompts: tenantRow.prompts ?? {},
          updatedAt: tenantRow.updatedAt ?? undefined,
        })
      : null;

    const effective = buildEffectiveLlmConfig({
      platform,
      industry,
      tenant: tenant ?? null,
    }).effective;

    const effectiveBase = buildEffectiveLlmConfig({
      platform,
      industry,
      tenant: null,
    }).effective;

    return NextResponse.json({ ok: true, tenant, effective, effectiveBase });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const code = msg === "NO_ACTIVE_TENANT" ? 401 : 500;
    return NextResponse.json({ ok: false, error: "REQUEST_FAILED", message: msg }, { status: code });
  }
}