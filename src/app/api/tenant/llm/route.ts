// src/app/api/tenant/llm/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { requirePlatformRole } from "@/lib/rbac/guards";
import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";
import { getIndustryDefaults, buildEffectiveLlmConfig } from "@/lib/pcc/llm/effective";
import { normalizeTenantOverrides, type TenantLlmOverrides } from "@/lib/pcc/llm/tenantTypes";
import { getTenantLlmOverrides, upsertTenantLlmOverrides } from "@/lib/pcc/llm/tenantStore";

export const runtime = "nodejs";
// Ensure Next doesn't try to cache this route
export const dynamic = "force-dynamic";

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
    // PCC-only endpoint: platform roles
    await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

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

    // IMPORTANT: fetch fresh platform config (avoid cached resolver helpers)
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

    const built = buildEffectiveLlmConfig({
      platform,
      industry,
      tenant,
    });

    return NextResponse.json({
      ok: true,
      platform,
      industry,
      tenant,
      effective: built.effective,
      permissions: { canEdit: true },
    });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    return NextResponse.json({ ok: false, error: "REQUEST_FAILED", message: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

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

    // Recompute effective with fresh platform config
    const platform = await loadPlatformLlmConfig();
    const industry = getIndustryDefaults(industryKey ? String(industryKey) : null);

    const tenantRow = await getTenantLlmOverrides(tenantId);
    const tenant: TenantLlmOverrides | null = tenantRow
      ? normalizeTenantOverrides({
          models: tenantRow.models ?? {},
          prompts: tenantRow.prompts ?? {},
          updatedAt: tenantRow.updatedAt ?? undefined,
        })
      : null;

    const built = buildEffectiveLlmConfig({
      platform,
      industry,
      tenant,
    });

    return NextResponse.json({ ok: true, tenant, effective: built.effective });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    return NextResponse.json({ ok: false, error: "REQUEST_FAILED", message: msg }, { status: 500 });
  }
}