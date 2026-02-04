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

type BlobPointer = {
  url: string;
  versionToken: string;
};

async function getBlobPointerIfExists(): Promise<BlobPointer | null> {
  try {
    const meta: any = await head(BLOB_KEY);

    const url = String(meta?.url ?? "").trim();
    if (!url) return null;

    const uploadedAt = meta?.uploadedAt ? String(meta.uploadedAt) : "";
    const size = Number.isFinite(meta?.size) ? String(meta.size) : "";
    const versionToken = uploadedAt || size || String(Date.now());

    return { url, versionToken };
  } catch {
    return null;
  }
}

function isPlainObject(v: any) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Merge envCfg (defaults) + blobCfg (overrides).
 * Blob wins, so UI persists even if PCC_LLM_CONFIG is set.
 */
function mergeConfig(envCfg: PlatformLlmConfig, blobCfg: PlatformLlmConfig): PlatformLlmConfig {
  return {
    ...envCfg,
    ...blobCfg,

    // merge nested objects (blob wins)
    models: {
      ...(isPlainObject((envCfg as any).models) ? (envCfg as any).models : {}),
      ...(isPlainObject((blobCfg as any).models) ? (blobCfg as any).models : {}),
    },

    prompts: {
      ...(isPlainObject((envCfg as any).prompts) ? (envCfg as any).prompts : {}),
      ...(isPlainObject((blobCfg as any).prompts) ? (blobCfg as any).prompts : {}),
      // renderStylePresets is nested too
      renderStylePresets: {
        ...(isPlainObject((envCfg as any).prompts?.renderStylePresets) ? (envCfg as any).prompts.renderStylePresets : {}),
        ...(isPlainObject((blobCfg as any).prompts?.renderStylePresets) ? (blobCfg as any).prompts.renderStylePresets : {}),
      },
    },

    guardrails: {
      ...(isPlainObject((envCfg as any).guardrails) ? (envCfg as any).guardrails : {}),
      ...(isPlainObject((blobCfg as any).guardrails) ? (blobCfg as any).guardrails : {}),
    },
  };
}

async function loadFromBlob(): Promise<PlatformLlmConfig | null> {
  const ptr = await getBlobPointerIfExists();
  if (!ptr) return null;

  try {
    const bustUrl = `${ptr.url}${ptr.url.includes("?") ? "&" : "?"}v=${encodeURIComponent(ptr.versionToken)}`;

    const res = await fetch(bustUrl, {
      cache: "no-store",
      next: { revalidate: 0 },
    });

    if (!res.ok) throw new Error(`Failed to fetch LLM config: ${res.status}`);

    const txt = await res.text();
    const cfg = safeParse(txt);
    return cfg ?? null;
  } catch {
    return null;
  }
}

export async function loadPlatformLlmConfig(): Promise<PlatformLlmConfig> {
  // 1) Read env (as defaults / seed)
  const envRaw = process.env.PCC_LLM_CONFIG?.trim();
  const envCfg = safeParse(envRaw || null);

  // 2) Read blob (persistent)
  const blobCfg = await loadFromBlob();

  // If BOTH exist: merge, blob wins (so UI saves persist)
  if (envCfg && blobCfg) return mergeConfig(envCfg, blobCfg);

  // If ONLY one exists, use it
  if (blobCfg) return blobCfg;
  if (envCfg) return envCfg;

  // 3) Default
  return defaultPlatformLlmConfig();
}

export async function savePlatformLlmConfig(cfg: PlatformLlmConfig): Promise<PlatformLlmConfig> {
  // Always stamp updatedAt on save (single source of truth)
  const next: PlatformLlmConfig = {
    ...cfg,
    version: Number.isFinite((cfg as any)?.version) ? (cfg as any).version : 1,
    updatedAt: nowIso(),
  };

  const payload = JSON.stringify(next, null, 2);

  await put(BLOB_KEY, payload, {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  return next;
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