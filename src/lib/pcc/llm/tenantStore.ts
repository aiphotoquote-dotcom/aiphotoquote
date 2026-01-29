// src/lib/pcc/llm/tenantStore.ts
import { put, head, del } from "@vercel/blob";

export type TenantLlmOverrides = {
  version?: number;
  updatedAt?: string | null;

  models?: {
    estimatorModel?: string;
    qaModel?: string;
    renderModel?: string;
  };

  prompts?: {
    quoteEstimatorSystem?: string;
    qaQuestionGeneratorSystem?: string;
    extraSystemPreamble?: string;
  };

  // Tenant may only tighten (min with platform cap)
  maxQaQuestions?: number;
};

function nowIso() {
  return new Date().toISOString();
}

function keyForTenant(tenantId: string) {
  return `pcc/llm/tenant/${tenantId}/llm-overrides.json`;
}

function safeParse(json: string | null): TenantLlmOverrides | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as TenantLlmOverrides;
  } catch {
    return null;
  }
}

async function getBlobUrlIfExists(key: string): Promise<string | null> {
  try {
    const meta = await head(key);
    return meta?.url ?? null;
  } catch {
    return null;
  }
}

export async function loadTenantLlmOverrides(tenantId: string): Promise<TenantLlmOverrides | null> {
  const tid = String(tenantId || "").trim();
  if (!tid) return null;

  const key = keyForTenant(tid);
  const url = await getBlobUrlIfExists(key);
  if (!url) return null;

  try {
    const res = await fetch(url, { cache: "no-store" });
    const txt = await res.text();
    return safeParse(txt);
  } catch {
    return null;
  }
}

export async function saveTenantLlmOverrides(tenantId: string, overrides: TenantLlmOverrides): Promise<void> {
  const tid = String(tenantId || "").trim();
  if (!tid) throw new Error("MISSING_TENANT_ID");

  const key = keyForTenant(tid);
  const payload = JSON.stringify(
    {
      ...overrides,
      version: overrides.version ?? 1,
      updatedAt: nowIso(),
    },
    null,
    2
  );

  // NOTE: Vercel Blob typing often only allows "public" in some setups.
  // If you later enable private blobs, you can switch this back.
  await put(key, payload, {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });
}

export async function resetTenantLlmOverrides(tenantId: string): Promise<void> {
  const tid = String(tenantId || "").trim();
  if (!tid) return;

  const key = keyForTenant(tid);
  try {
    await del(key);
  } catch {
    // ignore
  }
}