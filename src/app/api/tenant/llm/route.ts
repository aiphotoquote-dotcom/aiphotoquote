// src/app/api/tenant/llm/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { requirePlatformRole } from "@/lib/rbac/guards";
import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";
import { getTenantLlmOverrides } from "@/lib/pcc/llm/tenantStore";
import { normalizeTenantOverrides, type TenantLlmOverrides } from "@/lib/pcc/llm/tenantTypes";
import { getIndustryDefaults, buildEffectiveLlmConfig } from "@/lib/pcc/llm/effective";
import { upsertTenantLlmOverrides } from "@/lib/pcc/llm/tenantStore";

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

function noStoreJson(data: any, init?: { status?: number }) {
  return NextResponse.json(data, {
    status: init?.status ?? 200,
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      pragma: "no-cache",
      expires: "0",
    },
  });
}

export async function GET(req: Request) {
  try {
    // PCC UI is platform-only
    await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

    const url = new URL(req.url);
    const parsed = GetQuery.safeParse({
      tenantId: url.searchParams.get("tenantId") || "",
      industryKey: url.searchParams.get("industryKey") || undefined,
    });

    if (!parsed.success) {
      return noStoreJson(
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

    const effectiveBundle = buildEffectiveLlmConfig({
      platform,
      industry,
      tenant,
    });

    return noStoreJson({
      ok: true,
      platform,
      industry,
      tenant,
      effective: effectiveBundle.effective,
      permissions: { canEdit: true },
    });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    return noStoreJson({ ok: false, error: "REQUEST_FAILED", message: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await requirePlatformRole(["platform_owner", "platform_admin"]);

    const body = await req.json().catch(() => null);
    const parsed = PostBody.safeParse(body);
    if (!parsed.success) {
      return noStoreJson(
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

    const effectiveBundle = buildEffectiveLlmConfig({
      platform,
      industry,
      tenant,
    });

    return noStoreJson({ ok: true, tenant, effective: effectiveBundle.effective });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    return noStoreJson({ ok: false, error: "REQUEST_FAILED", message: msg }, { status: 500 });
  }
}