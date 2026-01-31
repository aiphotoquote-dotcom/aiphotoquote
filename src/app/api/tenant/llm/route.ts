// src/app/api/tenant/llm/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth/requireAdmin";
import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";
import { getPlatformLlm } from "@/lib/pcc/llm/apply";
import { normalizeTenantOverrides, type TenantLlmOverrides } from "@/lib/pcc/llm/tenantTypes";
import { getTenantLlmOverrides, upsertTenantLlmOverrides } from "@/lib/pcc/llm/tenantStore";
import { loadTenantIndustryConfig } from "@/lib/pcc/llm/tenantTypes"; // if you already had this elsewhere, keep it consistent

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
    await requireAdmin();

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
    const industry = industryKey ? await loadTenantIndustryConfig(industryKey) : null;

    const tenantRow = await getTenantLlmOverrides(tenantId);
    const tenant: TenantLlmOverrides | null = tenantRow
      ? normalizeTenantOverrides({
          models: tenantRow.models ?? {},
          prompts: tenantRow.prompts ?? {},
          // tenantStore is not responsible for maxQaQuestions unless you store it; keep normalize logic consistent
        })
      : null;

    const effective = getPlatformLlm({
      platform,
      industry: industry ?? undefined,
      tenant: tenant ?? undefined,
    });

    return NextResponse.json({
      ok: true,
      platform,
      industry: industry ?? {},
      tenant,
      effective,
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
    await requireAdmin();

    const body = await req.json().catch(() => null);
    const parsed = PostBody.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "BAD_REQUEST", message: "Invalid payload", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { tenantId, industryKey, overrides } = parsed.data;

    // Normalize tenant overrides (models/prompts only)
    const normalized = normalizeTenantOverrides(overrides ?? {});

    // Persist only what the DB supports today: models + prompts (+ updated_at handled by store)
    await upsertTenantLlmOverrides({
      tenantId,
      models: normalized.models ?? {},
      prompts: normalized.prompts ?? {},
    });

    // Return fresh effective view after save
    const platform = await loadPlatformLlmConfig();
    const industry = industryKey ? await loadTenantIndustryConfig(String(industryKey)) : null;

    const tenantRow = await getTenantLlmOverrides(tenantId);
    const tenant: TenantLlmOverrides | null = tenantRow
      ? normalizeTenantOverrides({
          models: tenantRow.models ?? {},
          prompts: tenantRow.prompts ?? {},
        })
      : null;

    const effective = getPlatformLlm({
      platform,
      industry: industry ?? undefined,
      tenant: tenant ?? undefined,
    });

    return NextResponse.json({ ok: true, tenant, effective });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const code = msg === "NO_ACTIVE_TENANT" ? 401 : 500;
    return NextResponse.json({ ok: false, error: "REQUEST_FAILED", message: msg }, { status: code });
  }
}