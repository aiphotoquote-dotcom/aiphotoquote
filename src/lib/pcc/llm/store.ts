// src/lib/pcc/llm/store.ts
import { put, head, del } from "@vercel/blob";
import { defaultPlatformLlmConfig, type PlatformLlmConfig } from "./types";

const BLOB_KEY = "pcc/llm/platform-llm-config.json";

function nowIso() {
  return new Date().toISOString();
}

/**
 * Very lightweight parse (route.ts is responsible for full normalization/validation).
 * This just ensures we got an object back.
 */
function safeParse(json: string | null): PlatformLlmConfig | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as PlatformLlmConfig;
  } catch {
    return null;
  }
}

async function getBlobUrlIfExists(): Promise<string | null> {
  try {
    const meta = await head(BLOB_KEY);
    return meta?.url ?? null;
  } catch {
    return null;
  }
}

export async function loadPlatformLlmConfig(): Promise<PlatformLlmConfig> {
  // 1) Env override first (fast, deploy-friendly)
  const envRaw = process.env.PCC_LLM_CONFIG?.trim();
  const envCfg = safeParse(envRaw || null);
  if (envCfg) return envCfg;

  // 2) Blob (persistent)
  const url = await getBlobUrlIfExists();
  if (url) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      const txt = await res.text();
      const cfg = safeParse(txt);
      if (cfg) return cfg;
    } catch {
      // fallthrough
    }
  }

  // 3) Default
  return defaultPlatformLlmConfig();
}

export async function savePlatformLlmConfig(cfg: PlatformLlmConfig): Promise<void> {
  // Always stamp updatedAt on save (single source of truth)
  const next: PlatformLlmConfig = {
    ...cfg,
    version: Number.isFinite(cfg?.version) ? cfg.version : 1,
    updatedAt: nowIso(),
  };

  const payload = JSON.stringify(next, null, 2);

  // Overwrite by using same key (Vercel Blob will version internally; URL changes)
  await put(BLOB_KEY, payload, {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });
}

/**
 * Optional: reset to defaults by deleting blob (won't affect env override).
 */
export async function resetPlatformLlmConfig(): Promise<void> {
  try {
    await del(BLOB_KEY);
  } catch {
    // ignore
  }
}