// src/app/api/tenant/llm/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { requirePlatformRole } from "@/lib/rbac/guards";
import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";
import { getPlatformLlm } from "@/lib/pcc/llm/apply";
import { normalizeTenantOverrides, type TenantLlmOverrides } from "@/lib/pcc/llm/tenantTypes";
import { getTenantLlmOverrides, upsertTenantLlmOverrides } from "@/lib/pcc/llm/tenantStore";

export const runtime = "nodejs";

const GetQuery = z.object({
  tenantId: z.string().uuid(),
  // keep for future layering, but we won't try to load industry config (it doesn't exist in repo)
  industryKey: z.string().optional(),
});

const PostBody = z.object({
  tenantId: z.string().uuid(),
  industryKey: z.string().nullable().optional(),
  overrides: z.any(),
});

function safeErr(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e ?? "Unknown error");
  return msg.slice(0, 2000);
}

export async function GET(req: Request) {
  try {
    // PCC-only endpoint (platform admins/support)
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

    const { tenantId } = parsed.data;

    const platform = await loadPlatformLlmConfig();

    // ✅ No industry loader exists in this repo yet — return empty object for now.
    const industry: Partial<typeof platform> = {};

    const tenantRow = await getTenantLlmOverrides(tenantId);
    const tenant: TenantLlmOverrides | null = tenantRow
      ? normalizeTenantOverrides({
          models: tenantRow.models ?? {},
          prompts: tenantRow.prompts ?? {},
          updatedAt: tenantRow.updatedAt ?? undefined,
        })
      : null;

    const effective = getPlatformLlm({
      platform,
      industry: industry as any,
      tenant: tenant ?? undefined,
    });

    return NextResponse.json({
      ok: true,
      platform,
      industry,
      tenant,
      effective,
      permissions: { canEdit: true },
    });
  } catch (e) {
    const msg = safeErr(e);

    // Guards may throw; treat as forbidden unless you intentionally throw "NO_ACTIVE_TENANT"
    const status = msg === "NO_ACTIVE_TENANT" ? 401 : 403;

    return NextResponse.json({ ok: false, error: "REQUEST_FAILED", message: msg }, { status });
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

    const { tenantId, overrides } = parsed.data;

    // Normalize tenant overrides (models/prompts/maxQaQuestions/updatedAt)
    // BUT: DB only stores models+prompts+updated_at today.
    const normalized = normalizeTenantOverrides(overrides ?? {});

    await upsertTenantLlmOverrides({
      tenantId,
      models: normalized.models ?? {},
      prompts: normalized.prompts ?? {},
    });

    // Return fresh effective view after save
    const platform = await loadPlatformLlmConfig();
    const industry: Partial<typeof platform> = {};

    const tenantRow = await getTenantLlmOverrides(tenantId);
    const tenant: TenantLlmOverrides | null = tenantRow
      ? normalizeTenantOverrides({
          models: tenantRow.models ?? {},
          prompts: tenantRow.prompts ?? {},
          updatedAt: tenantRow.updatedAt ?? undefined,
        })
      : null;

    const effective = getPlatformLlm({
      platform,
      industry: industry as any,
      tenant: tenant ?? undefined,
    });

    return NextResponse.json({ ok: true, tenant, effective });
  } catch (e) {
    const msg = safeErr(e);
    const status = msg === "NO_ACTIVE_TENANT" ? 401 : 403;
    return NextResponse.json({ ok: false, error: "REQUEST_FAILED", message: msg }, { status });
  }
}