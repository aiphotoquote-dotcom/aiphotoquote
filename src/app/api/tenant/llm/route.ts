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

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s;
}

function numClamp(v: unknown, min: number, max: number, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

/**
 * We don't have a dedicated DB column for maxQaQuestions.
 * Persist it in a reserved namespace inside models JSON:
 *   models._apq.maxQaQuestions
 */
function readMaxQaQuestionsFromRow(row: { models?: any } | null | undefined): number | null {
  const raw = row?.models?.["_apq"]?.maxQaQuestions;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(1, Math.min(10, Math.floor(n))) : null;
}

function writeMaxQaQuestionsIntoModels(models: any, maxQaQuestions: number | null) {
  const base = models && typeof models === "object" && !Array.isArray(models) ? models : {};
  const apq = base["_apq"] && typeof base["_apq"] === "object" && !Array.isArray(base["_apq"]) ? base["_apq"] : {};
  const nextApq =
    maxQaQuestions == null
      ? apq
      : {
          ...apq,
          maxQaQuestions: Math.max(1, Math.min(10, Math.floor(maxQaQuestions))),
        };

  // If we aren't setting it, just return original models
  if (maxQaQuestions == null) return base;

  return {
    ...base,
    _apq: nextApq,
  };
}

export async function GET(req: Request) {
  try {
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

    const tenant: (TenantLlmOverrides & { maxQaQuestions?: number }) | null = tenantRow
      ? (() => {
          const normalized = normalizeTenantOverrides({
            models: tenantRow.models ?? {},
            prompts: tenantRow.prompts ?? {},
            updatedAt: tenantRow.updatedAt ?? undefined,
          }) as any;

          const storedMax = readMaxQaQuestionsFromRow(tenantRow);
          if (storedMax != null) normalized.maxQaQuestions = storedMax;

          return normalized as any;
        })()
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
    const status = msg === "NO_ACTIVE_TENANT" ? 401 : 500;
    return NextResponse.json({ ok: false, error: "REQUEST_FAILED", message: msg }, { status });
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

    // Normalize known overrides (models/prompts)
    const normalized = normalizeTenantOverrides(overrides ?? {}) as any;

    // Pull maxQaQuestions (if present) and clamp. If missing, don't overwrite stored value.
    const incomingMaxQaQuestionsRaw = (overrides as any)?.maxQaQuestions;
    const incomingHasMaxQaQuestions = incomingMaxQaQuestionsRaw != null && safeTrim(incomingMaxQaQuestionsRaw) !== "";
    const incomingMaxQaQuestions = incomingHasMaxQaQuestions
      ? numClamp(incomingMaxQaQuestionsRaw, 1, 10, 3)
      : null;

    // Read current row so we can preserve existing _apq namespace if needed.
    const existingRow = await getTenantLlmOverrides(tenantId);
    const existingModels = existingRow?.models ?? {};

    const modelsToStore = incomingHasMaxQaQuestions
      ? writeMaxQaQuestionsIntoModels({ ...(existingModels as any), ...(normalized.models ?? {}) }, incomingMaxQaQuestions)
      : { ...(existingModels as any), ...(normalized.models ?? {}) };

    await upsertTenantLlmOverrides({
      tenantId,
      models: modelsToStore,
      prompts: normalized.prompts ?? {},
    });

    const platform = await loadPlatformLlmConfig();
    const industry = getIndustryDefaults((industryKey ?? null) as any);

    const tenantRow = await getTenantLlmOverrides(tenantId);
    const tenant: (TenantLlmOverrides & { maxQaQuestions?: number }) | null = tenantRow
      ? (() => {
          const t = normalizeTenantOverrides({
            models: tenantRow.models ?? {},
            prompts: tenantRow.prompts ?? {},
            updatedAt: tenantRow.updatedAt ?? undefined,
          }) as any;

          const storedMax = readMaxQaQuestionsFromRow(tenantRow);
          if (storedMax != null) t.maxQaQuestions = storedMax;

          return t as any;
        })()
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
    const status = msg === "NO_ACTIVE_TENANT" ? 401 : 500;
    return NextResponse.json({ ok: false, error: "REQUEST_FAILED", message: msg }, { status });
  }
}